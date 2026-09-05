import { beforeEach, expect, it, vi } from 'vitest';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { adminAuditLogs, communityTags, users } from '@/../db/schema';
import { setTestDb } from '@/lib/auth/db';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { GET, POST } from './route';

let token: string | undefined;
let db: TestDatabase;
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE_NAME && token ? { value: token } : undefined }) }));
beforeEach(async () => { db = await createTestClient(); setTestDb(db); token = undefined; });
const request = (body: unknown, key: string) => new Request('http://localhost/api/admin/community/tags', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });

it('uses a zero creation version, returns definite duplicate conflicts and validates int4 before SQL', async () => {
  const body = { name: '节日', slug: 'festival', sortOrder: 0, expectedVersion: 0, reason: '经人工核对的分类' };
  expect((await POST(request(body, 'unauthorized'))).status).toBe(401);
  const [moderator] = await db.insert(users).values({ email: 'tag-reviewer@example.test', role: 'moderator', emailVerifiedAt: new Date() }).returning();
  token = (await createSession(db, moderator.id)).token;
  expect((await POST(request({ name: '节日', slug: 'festival', reason: body.reason }, 'missing-base'))).status).toBe(400);
  expect((await POST(request({ ...body, sortOrder: 2147483648 }, 'large-order'))).status).toBe(400);
  const saved = await POST(request(body, 'create')); expect(saved.status).toBe(201);
  expect((await POST(request(body, 'create'))).status).toBe(200);
  const duplicate = await POST(request(body, 'another-create'));
  expect(duplicate.status).toBe(409); expect(await duplicate.json()).toMatchObject({ error: { code: 'STATE_CONFLICT' } });
  expect((await POST(request({ ...body, name: '动物', slug: 'animals' }, 'another-create'))).status).toBe(201);
  expect(await db.select().from(communityTags)).toHaveLength(2);
  expect(await db.select().from(adminAuditLogs)).toHaveLength(2);
  expect((await GET()).headers.get('cache-control')).toContain('no-store');
});
