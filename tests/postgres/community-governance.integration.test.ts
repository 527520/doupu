import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, count, eq, inArray } from 'drizzle-orm';
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
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString, max: 12 });
const db = drizzle(pool, { schema });
const ownedUsers: string[] = [];
const pattern = { width: 1, height: 1, cells: [{ hex: '#FF0000', code: 'R1', transparent: false }] };
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
