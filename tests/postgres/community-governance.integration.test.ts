import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, count, eq, inArray, sum } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../db/schema';
import {
  adminAuditLogs,
  communityLikes,
  communityReuses,
  communityRevisions,
  communityWorks,
  designs,
  idempotencyRecords,
  users,
} from '../../db/schema';
import { updateUserGovernance } from '@/lib/admin/userGovernance';
import type { Actor } from '@/lib/auth/authorization';
import { executeIdempotently } from '@/lib/idempotency';
import { reuseCommunityWork, setCommunityLike } from '@/lib/community/interactions';
import { reviewCommunityRevision } from '@/lib/community/service';
import { COMMUNITY_LICENSE_VERSION, deriveCommunityPreview, type CommunitySnapshotV1 } from '@/lib/community/snapshot';
import { DEFAULT_GENERATION_PARAMS, type ProjectFile } from '@/lib/types';
import { LIMITS } from '@/lib/appInfo';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { PUT as saveDesign } from '@/app/api/designs/[id]/route';
import { measureJsonBytes } from '@/lib/sync/revision';

let sessionToken = '';
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE_NAME ? { value: sessionToken } : undefined }) }));
vi.mock('@/lib/auth/db', () => ({ getDb: () => db }));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString, max: 12 });
const db = drizzle(pool, { schema });
const ownedUsers: string[] = [];
const pattern = { width: 1, height: 1, cells: [{ hex: '#FAF4C8', code: 'A01', transparent: false }] };
const snapshot: CommunitySnapshotV1 = {
  version: 1,
  engineVersion: 'postgres-contract',
  boardProfile: '5mm-29',
  paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
  params: { ...DEFAULT_GENERATION_PARAMS, backgroundPrototype: null },
  pattern,
};

async function createUser(role: 'user' | 'moderator' | 'admin' = 'user'): Promise<Actor> {
  const [user] = await db.insert(users).values({
    id: randomUUID(),
    email: `pg-contract-${randomUUID()}@example.test`,
    passwordHash: 'not-a-real-hash',
    role,
    emailVerifiedAt: new Date(),
  }).returning();
  ownedUsers.push(user.id);
  return { userId: user.id, role, accountStatus: 'active', emailVerified: true };
}

async function createPublishedWork(author: Actor) {
  const [work] = await db.insert(communityWorks).values({ authorUserId: author.userId }).returning();
  const [revision] = await db.insert(communityRevisions).values({
    workId: work.id,
    revisionNumber: 1,
    status: 'published',
    title: 'PostgreSQL 并发作品',
    authorType: 'user',
    publicAuthorId: randomUUID(),
    frozenDisplayName: '并发用户',
    licenseVersion: COMMUNITY_LICENSE_VERSION,
    licenseConfirmedAt: new Date(),
    engineVersion: snapshot.engineVersion,
    boardProfile: snapshot.boardProfile,
    paletteKind: 'builtin',
    paletteId: 'MARD',
    width: 1,
    height: 1,
    colorCount: 1,
    snapshot,
    preview: deriveCommunityPreview(pattern),
    reviewedAt: new Date(),
    publishedAt: new Date(),
  }).returning();
  const [current] = await db.update(communityWorks).set({ currentPublishedRevisionId: revision.id })
    .where(eq(communityWorks.id, work.id)).returning();
  return { work: current, revision };
}

beforeAll(async () => {
  const [row] = await db.select({ value: count() }).from(users).where(and(
    eq(users.role, 'admin'), eq(users.accountStatus, 'active'),
  ));
  if (row.value > 0) throw new Error('PostgreSQL governance contract requires a database without active administrators');
});

afterAll(async () => {
  if (ownedUsers.length > 0) await db.delete(users).where(inArray(users.id, ownedUsers));
  await pool.end();
});

describe('PostgreSQL 16 community and governance concurrency', () => {
  it.each(['active', 'bytes'] as const)('serializes ordinary saves and distinct idempotent reuses at the %s quota', async (quota) => {
    const actor = await createUser();
    const { work } = await createPublishedWork(actor);
    sessionToken = (await createSession(db, actor.userId)).token;
    const project: ProjectFile = {
      format: 'doupu-project', version: 3, name: 'candidate',
      engineVersion: snapshot.engineVersion, boardProfile: snapshot.boardProfile,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      paletteSelection: snapshot.paletteSelection, params: snapshot.params, pattern,
    };
    const seedBytes = quota === 'bytes' ? LIMITS.designBytesPerUser - Math.floor(measureJsonBytes(project) * 1.5) : 0;
    await db.insert(designs).values(Array.from({ length: quota === 'active' ? LIMITS.designsPerUser - 1 : 1 }, (_, index) => ({
      id: randomUUID(), userId: actor.userId, name: 'seed', project, payloadBytes: index === 0 ? seedBytes : 0,
    })));
    const designId = randomUUID();
    const save = saveDesign(new Request(`http://localhost:3000/api/designs/${designId}`, {
      method: 'PUT', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ name: project.name, project, baseRevision: 0 }),
    }), { params: Promise.resolve({ id: designId }) }).then(async (response) => {
      expect([200, 409], JSON.stringify(await response.json())).toContain(response.status);
      return response.status;
    });
    const reuse = () => executeIdempotently(db, {
      actorUserId: actor.userId, scope: `quota-reuse:${work.id}`, key: randomUUID(), request: { workId: work.id },
    }, (tx) => reuseCommunityWork(tx, { actor, workId: work.id })).then(() => 201);
    const results = await Promise.allSettled([save, reuse(), reuse()]);
    expect(results.filter((result) => result.status === 'fulfilled' && [200, 201].includes(result.value))).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'CONFLICT' });
      else expect([200, 201, 409]).toContain(result.value);
    }
    const [usage] = await db.select({ total: count(), bytes: sum(designs.payloadBytes) }).from(designs).where(eq(designs.userId, actor.userId));
    expect(usage.total).toBeLessThanOrEqual(LIMITS.designsPerUser);
    expect(Number(usage.bytes)).toBeLessThanOrEqual(LIMITS.designBytesPerUser);
    expect(await db.select().from(communityReuses).where(eq(communityReuses.workId, work.id))).toHaveLength(results[0].status === 'fulfilled' && results[0].value === 200 ? 0 : 1);
  });

  it('serializes competing removals and preserves one active administrator', async () => {
    const left = await createUser('admin');
    const right = await createUser('admin');
    const changes = await Promise.allSettled([
      updateUserGovernance(db, {
        actorUserId: left.userId, targetUserId: right.userId, targetConfirmation: right.userId,
        role: 'user', expectedVersion: 1, reason: '并发管理员轮换左侧操作', requestId: randomUUID(),
      }),
      updateUserGovernance(db, {
        actorUserId: right.userId, targetUserId: left.userId, targetConfirmation: left.userId,
        role: 'user', expectedVersion: 1, reason: '并发管理员轮换右侧操作', requestId: randomUUID(),
      }),
    ]);
    expect(changes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const active = await db.select({ id: users.id }).from(users).where(and(
      eq(users.role, 'admin'), eq(users.accountStatus, 'active'),
    ));
    expect(active).toHaveLength(1);
  });

  it('keeps like and idempotent reuse facts exact under concurrent requests', async () => {
    const actor = await createUser();
    const { work } = await createPublishedWork(actor);
    const likes = await Promise.all([
      setCommunityLike(db, { actor, workId: work.id, liked: true }),
      setCommunityLike(db, { actor, workId: work.id, liked: true }),
    ]);
    expect(likes.every((result) => result.likeCount === 1)).toBe(true);
    expect(await db.select().from(communityLikes).where(eq(communityLikes.workId, work.id))).toHaveLength(1);

    const key = randomUUID();
    const request = { workId: work.id };
    const reuses = await Promise.all([
      executeIdempotently(db, { actorUserId: actor.userId, scope: `pg-reuse:${work.id}`, key, request },
        (tx) => reuseCommunityWork(tx, { actor, workId: work.id })),
      executeIdempotently(db, { actorUserId: actor.userId, scope: `pg-reuse:${work.id}`, key, request },
        (tx) => reuseCommunityWork(tx, { actor, workId: work.id })),
    ]);
    expect(reuses.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(reuses[0].value.designId).toBe(reuses[1].value.designId);
    expect(await db.select().from(communityReuses).where(eq(communityReuses.workId, work.id))).toHaveLength(1);
    expect(await db.select().from(designs).where(eq(designs.communitySourceWorkId, work.id))).toHaveLength(1);
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, work.id)))[0].reuseCount).toBe(1);
    expect(await db.select().from(idempotencyRecords).where(eq(idempotencyRecords.key, key))).toHaveLength(1);
  });

  it('allows only one reviewer to publish the same revision version', async () => {
    const author = await createUser();
    const moderator = await createUser('moderator');
    const [work] = await db.insert(communityWorks).values({ authorUserId: author.userId }).returning();
    const [pending] = await db.insert(communityRevisions).values({
      workId: work.id,
      revisionNumber: 1,
      status: 'pending_review',
      version: 1,
      title: '并发审核作品',
      authorType: 'user',
      publicAuthorId: randomUUID(),
      frozenDisplayName: '并发作者',
      licenseVersion: COMMUNITY_LICENSE_VERSION,
      licenseConfirmedAt: new Date(),
      engineVersion: snapshot.engineVersion,
      boardProfile: snapshot.boardProfile,
      paletteKind: 'builtin',
      paletteId: 'MARD',
      width: 1,
      height: 1,
      colorCount: 1,
      snapshot,
      preview: deriveCommunityPreview(pattern),
      submittedAt: new Date(),
    }).returning();
    const reviews = await Promise.allSettled([
      reviewCommunityRevision(db, { actor: moderator, revisionId: pending.id, expectedVersion: 1,
        decision: 'published', reason: '并发审核第一次操作', requestId: randomUUID() }),
      reviewCommunityRevision(db, { actor: moderator, revisionId: pending.id, expectedVersion: 1,
        decision: 'published', reason: '并发审核第二次操作', requestId: randomUUID() }),
    ]);
    expect(reviews.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await db.select().from(communityRevisions).where(eq(communityRevisions.id, pending.id)))[0].status).toBe('published');
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, work.id)))[0].currentPublishedRevisionId).toBe(pending.id);
    expect(await db.select().from(adminAuditLogs).where(and(
      eq(adminAuditLogs.targetType, 'community_revision'), eq(adminAuditLogs.targetId, pending.id),
    ))).toHaveLength(1);
  });
});
