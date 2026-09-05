import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from './testClient';
import {
  communityRevisions,
  communityRevisionTags,
  communityTags,
  communityWorks,
  users,
} from './schema';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { anonymizeAccount } from '@/lib/auth/accountLifecycle';
import { mergeCommunityTag } from '@/lib/community/adminService';
import { listManagedCommunityWorks } from '@/lib/community/adminQueries';
import {
  getPublicCommunityWork,
  listCommunityReviewQueue,
  listOwnCommunityWorks,
  listPublicCommunityWorks,
  parseCommunityListUrl,
} from '@/lib/community/queries';
import {
  COMMUNITY_LICENSE_VERSION,
  deriveCommunityPreview,
  type CommunitySnapshotV1,
} from '@/lib/community/snapshot';

const pattern = {
  width: 2,
  height: 1,
  cells: [
    { hex: '#FF0000', code: 'R1', transparent: false },
    { hex: '#FFFFFF', code: 'W1', transparent: false },
  ],
};

const snapshot: CommunitySnapshotV1 = {
  version: 1,
  engineVersion: 'query-test',
  boardProfile: '5mm-29',
  paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
  params: { ...DEFAULT_GENERATION_PARAMS, backgroundPrototype: null },
  pattern,
};

describe('public community query boundary', () => {
  let db: TestDatabase;
  let authorId: string;
  let publicAuthorId: string;
  let resolvedTagId: string;
  const workIds: string[] = [];

  beforeEach(async () => {
    db = await createTestClient();
    workIds.length = 0;
    publicAuthorId = crypto.randomUUID();
    const [author] = await db.insert(users).values({
      email: 'query-author@example.com',
      username: 'Alice',
      passwordHash: 'hash',
      publicAuthorId,
      emailVerifiedAt: new Date(),
    }).returning();
    authorId = author.id;
    const [resolved, alias] = await db.insert(communityTags).values([
      { name: '宠物', slug: 'pets', sortOrder: 1 },
      { name: '旧宠物', slug: 'old-pets', sortOrder: 2 },
    ]).returning();
    resolvedTagId = resolved.id;
    await db.update(communityTags).set({ active: false, mergedIntoTagId: resolved.id })
      .where(eq(communityTags.id, alias.id));

    for (let index = 0; index < 25; index += 1) {
      const publishedAt = new Date(Date.UTC(2026, 8, 5, 12 - index));
      const [work] = await db.insert(communityWorks).values({
        authorUserId: author.id,
        likeCount: index,
        commentCount: index % 3,
        reuseCount: index % 5,
        commentsLocked: index === 0,
        featuredAt: index === 3 ? publishedAt : null,
        createdAt: publishedAt,
        updatedAt: publishedAt,
      }).returning();
      const [revision] = await db.insert(communityRevisions).values({
        workId: work.id,
        revisionNumber: 1,
        status: 'published',
        title: `查询作品 ${String(index).padStart(2, '0')}`,
        authorType: 'user',
        publicAuthorId,
        frozenDisplayName: 'Alice',
        licenseVersion: COMMUNITY_LICENSE_VERSION,
        licenseConfirmedAt: publishedAt,
        engineVersion: snapshot.engineVersion,
        boardProfile: snapshot.boardProfile,
        paletteKind: 'builtin',
        paletteId: 'MARD',
        width: pattern.width,
        height: pattern.height,
        colorCount: 2,
        snapshot,
        preview: deriveCommunityPreview(pattern),
        reviewedAt: publishedAt,
        publishedAt,
        createdAt: publishedAt,
        updatedAt: publishedAt,
      }).returning();
      await db.update(communityWorks).set({ currentPublishedRevisionId: revision.id })
        .where(eq(communityWorks.id, work.id));
      await db.insert(communityRevisionTags).values({ revisionId: revision.id, tagId: resolved.id });
      workIds.push(work.id);
    }

    const [pendingWork] = await db.insert(communityWorks).values({ authorUserId: author.id }).returning();
    await db.insert(communityRevisions).values({
      workId: pendingWork.id,
      revisionNumber: 1,
      status: 'pending_review',
      title: '待审查询作品',
      authorType: 'user',
      publicAuthorId,
      frozenDisplayName: 'Alice',
      licenseVersion: COMMUNITY_LICENSE_VERSION,
      licenseConfirmedAt: new Date('2026-09-05T13:00:00Z'),
      engineVersion: snapshot.engineVersion,
      boardProfile: snapshot.boardProfile,
      paletteKind: 'builtin',
      paletteId: 'MARD',
      width: pattern.width,
      height: pattern.height,
      colorCount: 2,
      snapshot,
      preview: deriveCommunityPreview(pattern),
      submittedAt: new Date('2026-09-05T13:00:00Z'),
    });
  });

  it('parses filters, resolves merged tags, and never exposes internal user ids', async () => {
    expect(parseCommunityListUrl('https://doupu.test/community?q=%E6%9F%A5%E8%AF%A2&author=Alice&tag=old-pets&boardProfile=5mm-29&palette=MARD&from=2026-09-04&to=2026-09-06&sort=popular'))
      .toMatchObject({ q: '查询', author: 'Alice', tag: 'old-pets', boardProfile: '5mm-29', palette: 'MARD', sort: 'popular' });

    const filtered = await listPublicCommunityWorks(db, {
      q: '作品 03', author: 'Alice', tag: 'old-pets', boardProfile: '5mm-29', palette: 'MARD',
      from: '2026-09-04', to: '2026-09-06', sort: 'popular',
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]).toMatchObject({
      title: '查询作品 03',
      author: { authorType: 'user', publicAuthorId, displayName: 'Alice' },
      tags: [{ id: resolvedTagId, name: '宠物', slug: 'pets' }],
    });
    expect(JSON.stringify(filtered)).not.toContain(authorId);
    await expect(listPublicCommunityWorks(db, { sort: 'latest', cursor: 'not-a-cursor' }))
      .rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(listPublicCommunityWorks(db, { sort: 'latest', tag: 'missing' }))
      .resolves.toMatchObject({ items: [] });
  });

  it('paginates deterministically and returns the frozen detail only while public', async () => {
    const first = await listPublicCommunityWorks(db, { sort: 'latest' });
    expect(first.items).toHaveLength(24);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listPublicCommunityWorks(db, { sort: 'latest', cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(25);

    await expect(listPublicCommunityWorks(db, { sort: 'featured' })).resolves.toMatchObject({ items: expect.any(Array) });
    const detail = await getPublicCommunityWork(db, workIds[0]);
    expect(detail).toMatchObject({ commentsLocked: true, snapshot, preview: deriveCommunityPreview(pattern) });
    expect(JSON.stringify(detail)).not.toContain(authorId);
    await db.update(communityWorks).set({ lifecycleStatus: 'withdrawn' }).where(eq(communityWorks.id, workIds[0]));
    await expect(getPublicCommunityWork(db, workIds[0])).resolves.toBeNull();
  });

  it('keeps private review facts separate and applies anonymized display names', async () => {
    const own = await listOwnCommunityWorks(db, authorId);
    expect(own).toHaveLength(26);
    expect(own.some((work) => work.revisions.some((revision) => revision.status === 'pending_review'))).toBe(true);
    const queue = await listCommunityReviewQueue(db);
    expect(queue).toMatchObject([{
      title: '待审查询作品',
      author: { authorType: 'user', publicAuthorId, displayName: 'Alice' },
    }]);
    expect(queue[0]).not.toHaveProperty('publicAuthorId');
    expect(queue[0]).not.toHaveProperty('frozenDisplayName');

    await db.update(users).set({ accountStatus: 'anonymized' }).where(eq(users.id, authorId));
    const detail = await getPublicCommunityWork(db, workIds[1]);
    expect(detail?.author.displayName).toBe('已注销用户');
  });

  it('cannot rediscover an anonymized author by the old frozen name or its fragments', async () => {
    await anonymizeAccount(db, { userId: authorId, requestId: 'erase-author-search' });
    for (const author of ['Alice', 'lic']) {
      expect((await listPublicCommunityWorks(db, { sort: 'latest', author })).items).toEqual([]);
      expect((await listManagedCommunityWorks(db, { q: author })).items).toEqual([]);
    }
    expect((await listManagedCommunityWorks(db, { q: '已注销用户' })).items).toHaveLength(26);
    const retained = await listPublicCommunityWorks(db, { sort: 'latest', author: publicAuthorId });
    expect(retained.items).toHaveLength(24);
    expect(retained.items.every((item) => item.author.displayName === '已注销用户')).toBe(true);
    expect((await listPublicCommunityWorks(db, { sort: 'latest', author: '已注销用户' })).items).toHaveLength(24);
    expect((await getPublicCommunityWork(db, workIds[0]))?.author.publicAuthorId).toBe(publicAuthorId);
  });

  it('resolves the whole historical merge chain and rejects cycles or inactive targets', async () => {
    const [final] = await db.insert(communityTags).values({ name: '动物', slug: 'animals' }).returning();
    const actor = { userId: authorId, role: 'moderator' as const, accountStatus: 'active' as const, emailVerified: true };
    await mergeCommunityTag(db, { actor, sourceTagId: resolvedTagId, targetTagId: final.id, expectedVersion: 1,
      reason: '连续合并到最终标签', requestId: 'merge-chain' });
    const terminal = await listPublicCommunityWorks(db, { sort: 'latest', tag: 'animals' });
    for (const tag of ['old-pets', 'pets']) {
      expect((await listPublicCommunityWorks(db, { sort: 'latest', tag })).items.map((item) => item.id)).toEqual(terminal.items.map((item) => item.id));
    }
    expect(terminal.items.every((item) => item.tags.length === 1 && item.tags[0].id === final.id)).toBe(true);
    await expect(mergeCommunityTag(db, { actor, sourceTagId: final.id, targetTagId: resolvedTagId, expectedVersion: 1,
      reason: '禁止形成合并环路', requestId: 'cycle' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [inactive] = await db.insert(communityTags).values({ name: '停用', slug: 'inactive', active: false }).returning();
    await expect(mergeCommunityTag(db, { actor, sourceTagId: final.id, targetTagId: inactive.id, expectedVersion: 1,
      reason: '禁止合并到停用标签', requestId: 'inactive' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
