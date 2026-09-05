import { beforeEach, expect, it, vi } from 'vitest';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { adminAuditLogs, moderationRuleSetVersions, users } from '@/../db/schema';
import { setTestDb } from '@/lib/auth/db';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { GET, POST } from './route';

let token: string | undefined;
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE_NAME && token ? { value: token } : undefined }) }));
let db: TestDatabase;
const rules = [{ literal: '测试词', category: 'spam', risk: 'review' }];
const request = (body: unknown, key = 'rule-version') => new Request('http://localhost/api/admin/moderation-rules', {
  method: 'POST', headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body),
});
beforeEach(async () => { db = await createTestClient(); setTestDb(db); token = undefined; });
it('only admins read and change rules; missing or stale bases never replace the current version', async () => {
  const body = { rules, reason: '经人工确认的规则', expectedVersion: 1 };
  expect((await GET()).status).toBe(401); expect((await POST(request(body))).status).toBe(401);
  const [moderator, admin] = await db.insert(users).values([
    { email: 'moderator@example.test', role: 'moderator', emailVerifiedAt: new Date() },
    { email: 'admin@example.test', role: 'admin', emailVerifiedAt: new Date() },
  ]).returning();
  token = (await createSession(db, moderator.id)).token;
  expect((await GET()).status).toBe(403); expect((await POST(request(body))).status).toBe(403);
  token = (await createSession(db, admin.id)).token;
  expect((await POST(request({ rules, reason: body.reason }))).status).toBe(400);
  const first = await POST(request(body)); expect(first.status).toBe(201);
  const saved = await first.json();
  expect(await (await POST(request(body))).json()).toEqual(saved);
  expect((await POST(request({ ...body, rules: [{ ...rules[0], literal: '另一个词' }] }, 'stale'))).status).toBe(409);
  const versions = await db.select().from(moderationRuleSetVersions);
  expect(versions).toHaveLength(2);
  expect(versions.find((version) => version.active)).toMatchObject({ version: 2, rules });
  expect(await db.select().from(adminAuditLogs)).toHaveLength(1);
  const response = await GET(); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(JSON.stringify(await response.json())).not.toContain(admin.id);
});
