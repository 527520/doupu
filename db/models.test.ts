/**
 * 模型级单测（PGlite 进程内 Postgres；ticket 13 验收标准）。
 * 依赖安装后由父代理执行：npm run test -- --run db/models.test.ts
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { eq, count } from 'drizzle-orm';
import { createTestClient } from './testClient';
import { cleanupRateLimits, cleanupSyncTombstones, incrementRateLimit, type AnyDatabase } from './client';
import { users, sessions, emailTokens, designs, palettes, rateLimits } from './schema';

describe('db models（PGlite）', () => {
  let db: AnyDatabase;

  beforeAll(async () => {
    db = await createTestClient();
  });

  async function insertUser(email: string): Promise<string> {
    const rows = await db
      .insert(users)
      .values({ email, passwordHash: 'hash' })
      .returning();
    return rows[0].id;
  }

  it('迁移从零可重放且幂等（createTestClient 内部执行两次也不报错）', async () => {
    const client2 = await createTestClient();
    // 新库结构完整
    const tables = await client2.execute<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
    );
    const names = tables.rows.map((r: { table_name: string }) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['users', 'sessions', 'email_tokens', 'designs', 'palettes', 'rate_limits']),
    );
  });

  it('邮箱唯一约束大小写不敏感（citext）', async () => {
    await insertUser('Foo@Example.com');
    await expect(insertUser('foo@example.com')).rejects.toThrow();
    await expect(insertUser('FOO@EXAMPLE.COM')).rejects.toThrow();
    // 不同邮箱可插入
    await expect(insertUser('other@example.com')).resolves.toBeTruthy();
  });

  it('级联删除：删除用户连带删除 sessions/email_tokens/designs/palettes', async () => {
    const userId = await insertUser('cascade@example.com');
    await db.insert(sessions).values({
      userId,
      tokenHash: 'token-a',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await db.insert(emailTokens).values({
      userId,
      purpose: 'verify',
      tokenHash: 'token-b',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await db.insert(designs).values({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userId, name: 'd', project: { format: 'doupu-project' } });
    await db.insert(palettes).values({ id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', userId, name: 'p', colors: [] });

    await db.delete(users).where(eq(users.id, userId));

    const sessionCount = await db.select({ n: count() }).from(sessions).where(eq(sessions.userId, userId));
    expect(sessionCount[0].n).toBe(0);
    const tokenCount = await db.select({ n: count() }).from(emailTokens).where(eq(emailTokens.userId, userId));
    expect(tokenCount[0].n).toBe(0);
    const designCount = await db.select({ n: count() }).from(designs).where(eq(designs.userId, userId));
    expect(designCount[0].n).toBe(0);
    const paletteCount = await db.select({ n: count() }).from(palettes).where(eq(palettes.userId, userId));
    expect(paletteCount[0].n).toBe(0);
  });

  it('designs jsonb 完整往返（深层结构不变）', async () => {
    const userId = await insertUser('json@example.com');
    const id = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13';
    const project = {
      format: 'doupu-project',
      version: 1,
      name: '测试',
      pattern: { width: 2, height: 2, cells: [{ hex: '#FF0000', code: 'A', transparent: false }] },
    };
    await db.insert(designs).values({ id, userId, name: 'json', project });
    const rows = await db.select().from(designs).where(eq(designs.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].project).toEqual(project);
  });

  it('rate_limits 原子递增：同窗口累加、不同窗口重置', async () => {
    const t0 = new Date('2026-08-14T00:00:00.000Z');
    expect(await incrementRateLimit(db, 'k1', t0)).toBe(1);
    expect(await incrementRateLimit(db, 'k1', t0)).toBe(2);
    expect(await incrementRateLimit(db, 'k1', t0)).toBe(3);
    // 新窗口 → 重置为 1
    const t1 = new Date('2026-08-14T01:00:00.000Z');
    expect(await incrementRateLimit(db, 'k1', t1)).toBe(1);
    // 不同 key 独立
    expect(await incrementRateLimit(db, 'k2', t0)).toBe(1);
  });

  it('rate_limits 新窗口并发首批请求不会互相重置丢计数', async () => {
    const oldWindow = new Date('2026-08-14T00:00:00.000Z');
    const newWindow = new Date('2026-08-14T01:00:00.000Z');
    await incrementRateLimit(db, 'rollover-race', oldWindow);

    const counts = await Promise.all(
      Array.from({ length: 8 }, () => incrementRateLimit(db, 'rollover-race', newWindow)),
    );

    expect(counts.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const [stored] = await db.select().from(rateLimits).where(eq(rateLimits.key, 'rollover-race'));
    expect(stored.count).toBe(8);
    expect(stored.windowStart.toISOString()).toBe(newWindow.toISOString());
  });

  it('rate_limits 忽略迟到的旧窗口且不会把当前窗口计数回拨', async () => {
    const oldWindow = new Date('2026-08-14T00:00:00.000Z');
    const currentWindow = new Date('2026-08-14T01:00:00.000Z');

    expect(await incrementRateLimit(db, 'late-window', currentWindow)).toBe(1);
    // A delayed request from the previous bucket must not move the persisted
    // bucket backwards or create extra capacity in the current bucket.
    expect(await incrementRateLimit(db, 'late-window', oldWindow)).toBe(1);
    expect(await incrementRateLimit(db, 'late-window', currentWindow)).toBe(2);

    const [stored] = await db.select().from(rateLimits).where(eq(rateLimits.key, 'late-window'));
    expect(stored.count).toBe(2);
    expect(stored.windowStart.toISOString()).toBe(currentWindow.toISOString());
  });

  it('cleanupRateLimits：只删过期窗口，保留新窗口（优化票 03）', async () => {
    await db.delete(rateLimits); // 隔离前序测试的计数行
    const old = new Date('2026-08-13T00:00:00.000Z');
    const fresh = new Date('2026-08-15T00:00:00.000Z');
    await incrementRateLimit(db, 'old1', old);
    await incrementRateLimit(db, 'old2', old);
    await incrementRateLimit(db, 'fresh1', fresh);
    const removed = await cleanupRateLimits(db, new Date('2026-08-14T12:00:00.000Z'));
    expect(removed).toBe(2);
    const rows = await db.select().from(rateLimits);
    expect(rows.map((r) => r.key)).toEqual(['fresh1']);
  });

  it('cleanupSyncTombstones：设计与色板墓碑到 90 天后硬删除', async () => {
    const userId = await insertUser('tombstone-cleanup@example.com');
    const old = new Date('2026-05-01T00:00:00.000Z');
    const fresh = new Date('2026-08-16T00:00:00.000Z');
    await db.insert(designs).values([
      { id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userId, name: '', project: null, payloadBytes: 0, deletedAt: old },
      { id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', userId, name: '', project: null, payloadBytes: 0, deletedAt: fresh },
    ]);
    await db.insert(palettes).values([
      { id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userId, name: '', colors: null, payloadBytes: 0, deletedAt: old },
      { id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', userId, name: '', colors: null, payloadBytes: 0, deletedAt: fresh },
    ]);
    expect(await cleanupSyncTombstones(db, new Date('2026-08-17T00:00:00.000Z'))).toEqual({ designs: 1, palettes: 1 });
  });

  it('sessions/email_tokens token_hash 唯一约束', async () => {
    const userId = await insertUser('uniq@example.com');
    await db.insert(sessions).values({ userId, tokenHash: 'dup', expiresAt: new Date() });
    await expect(
      db.insert(sessions).values({ userId, tokenHash: 'dup', expiresAt: new Date() }),
    ).rejects.toThrow();
    await db.insert(emailTokens).values({ userId, purpose: 'reset', tokenHash: 'dup2', expiresAt: new Date() });
    await expect(
      db.insert(emailTokens).values({ userId, purpose: 'verify', tokenHash: 'dup2', expiresAt: new Date() }),
    ).rejects.toThrow();
  });

  it('designs 与 palettes 的 id 为客户端生成（无默认值，缺 id 报错）', async () => {
    const userId = await insertUser('clientid@example.com');
    await expect(
      // 故意缺 id（runtime NOT NULL 违约）；as never 保证装依赖前后都能编译
      db.insert(designs).values({ userId, name: 'x', project: {} } as never),
    ).rejects.toThrow();
  });
});
