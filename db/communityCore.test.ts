import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from './testClient';
import {
  adminAuditLogs,
  communityRevisions,
  communityRevisionTags,
  communityTags,
  communityWorks,
  designs,
  users,
} from './schema';
import type { Actor } from '@/lib/auth/authorization';
import { DEFAULT_GENERATION_PARAMS, type ProjectFile } from '@/lib/types';
import { COMMUNITY_LICENSE_VERSION } from '@/lib/community/snapshot';
import {
  createCommunityRevision,
  createCommunityWork,
  reviewCommunityRevision,
  submitCommunityRevision,
  withdrawCommunityWork,
} from '@/lib/community/service';
import {
  createCommunityTag,
  mergeCommunityTag,
  moderateCommunityWork,
  updateCommunityTag,
} from '@/lib/community/adminService';

function project(name: string, hex = '#FF0000'): ProjectFile {
  return {
    format: 'doupu-project', version: 3, engineVersion: 'test', boardProfile: '5mm-29',
    name, createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    paletteSelection: { palette: { kind: 'custom', colors: [{ hex, code: 'C1' }] }, kitTier: 0 },
    params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 20, targetColorCount: 2 },
    pattern: { width: 2, height: 1, cells: [
      { hex, code: 'C1', transparent: false }, { hex, code: 'C1', transparent: false },
    ] },
  };
}

describe('community work and frozen revision state machine', () => {
  let db: TestDatabase;
  let user: Actor;
  let moderator: Actor;
  let designId: string;
  let tagId: string;

  beforeEach(async () => {
    db = await createTestClient();
    const [author, reviewer] = await db.insert(users).values([
      { email: 'alice@example.com', username: 'Alice', passwordHash: 'hash', emailVerifiedAt: new Date() },
      { email: 'mod@example.com', username: 'Mod', passwordHash: 'hash', emailVerifiedAt: new Date(), role: 'moderator' },
    ]).returning();
    user = { userId: author.id, role: 'user', accountStatus: 'active', emailVerified: true };
    moderator = { userId: reviewer.id, role: 'moderator', accountStatus: 'active', emailVerified: true };
    designId = crypto.randomUUID();
    await db.insert(designs).values({ id: designId, userId: author.id, name: 'private', project: project('private'), payloadBytes: 1 });
    const [tag] = await db.insert(communityTags).values({ name: '动物', slug: 'animals' }).returning();
    tagId = tag.id;
  });

  it('rejects an outdated source preview without freezing a different cloud revision', async () => {
    await expect(createCommunityWork(db, {
      actor: user, designId, title: '已预览的作品', licenseVersion: COMMUNITY_LICENSE_VERSION,
      expectedDesignRevision: 99,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await db.select().from(communityWorks)).toHaveLength(0);
  });

  it('keeps the approved revision public while a replacement awaits review', async () => {
    const created = await createCommunityWork(db, {
      actor: user, designId, expectedDesignRevision: 1, title: '红色小猫', licenseVersion: COMMUNITY_LICENSE_VERSION, tagIds: [tagId],
    });
    expect(created.revision.status).toBe('draft');
    expect(await db.select().from(communityRevisionTags)).toHaveLength(1);
    await db.update(designs).set({ project: project('changed', '#00FF00') }).where(eq(designs.id, designId));
    expect(JSON.stringify(created.revision.snapshot)).toContain('#FF0000');

    const submitted = await submitCommunityRevision(db, { actor: user, revisionId: created.revision.id, expectedVersion: 1 });
    const published = await reviewCommunityRevision(db, {
      actor: moderator, revisionId: submitted.id, expectedVersion: submitted.version,
      decision: 'published', reason: '内容安全且图纸完整', requestId: 'review-1',
    });
    expect(published.status).toBe('published');

    const replacement = await createCommunityRevision(db, {
      actor: user, workId: created.work.id, designId, expectedDesignRevision: 1, title: '绿色小猫',
      licenseVersion: COMMUNITY_LICENSE_VERSION,
    });
    const replacementPending = await submitCommunityRevision(db, {
      actor: user, revisionId: replacement.id, expectedVersion: replacement.version,
    });
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, created.work.id)))[0].currentPublishedRevisionId).toBe(published.id);

    await reviewCommunityRevision(db, {
      actor: moderator, revisionId: replacement.id, expectedVersion: replacementPending.version,
      decision: 'published', reason: '修改版审核通过', requestId: 'review-2',
    });
    const revisions = await db.select().from(communityRevisions).where(eq(communityRevisions.workId, created.work.id));
    expect(revisions.sort((a, b) => a.revisionNumber - b.revisionNumber).map((revision) => [revision.revisionNumber, revision.status])).toEqual([[1, 'superseded'], [2, 'published']]);
    expect(await db.select().from(adminAuditLogs)).toHaveLength(2);
  });

  it('withdraws the work and any pending revision without deleting approval facts', async () => {
    const created = await createCommunityWork(db, {
      actor: user, designId, expectedDesignRevision: 1, title: '待撤回作品', licenseVersion: COMMUNITY_LICENSE_VERSION,
    });
    const pending = await submitCommunityRevision(db, { actor: user, revisionId: created.revision.id, expectedVersion: 1 });
    const withdrawn = await withdrawCommunityWork(db, { actor: user, workId: created.work.id, expectedVersion: 1 });
    expect(withdrawn.lifecycleStatus).toBe('withdrawn');
    expect((await db.select().from(communityRevisions).where(eq(communityRevisions.id, pending.id)))[0].status).toBe('withdrawn');
  });

  it('moves tag links atomically and restores the last approved work revision', async () => {
    const created = await createCommunityWork(db, {
      actor: user, designId, expectedDesignRevision: 1, title: '治理作品', licenseVersion: COMMUNITY_LICENSE_VERSION, tagIds: [tagId],
    });
    const pending = await submitCommunityRevision(db, { actor: user, revisionId: created.revision.id, expectedVersion: 1 });
    await reviewCommunityRevision(db, {
      actor: moderator, revisionId: pending.id, expectedVersion: pending.version,
      decision: 'published', reason: '审核通过用于治理测试', requestId: 'review-governance',
    });
    const [publishedWork] = await db.select().from(communityWorks).where(eq(communityWorks.id, created.work.id));
    const removed = await moderateCommunityWork(db, {
      actor: moderator, workId: created.work.id, action: 'remove', expectedVersion: publishedWork.version,
      reason: '收到有效治理案件', requestId: 'remove-1',
    });
    expect(removed.lifecycleStatus).toBe('removed');
    const restored = await moderateCommunityWork(db, {
      actor: moderator, workId: created.work.id, action: 'restore', expectedVersion: removed.version,
      reason: '复核确认可以恢复', requestId: 'restore-1',
    });
    expect(restored).toMatchObject({ lifecycleStatus: 'active', currentPublishedRevisionId: created.revision.id });

    const [target] = await db.insert(communityTags).values({ name: '宠物', slug: 'pets' }).returning();
    const source = (await db.select().from(communityTags).where(eq(communityTags.id, tagId)))[0];
    const merged = await mergeCommunityTag(db, {
      actor: moderator, sourceTagId: tagId, targetTagId: target.id, expectedVersion: source.version,
      reason: '标签语义重复需要归并', requestId: 'merge-1',
    });
    expect(merged).toMatchObject({ active: false, mergedIntoTagId: target.id });
    expect(await db.select().from(communityRevisionTags)).toMatchObject([{ revisionId: created.revision.id, tagId: target.id }]);
  });

  it('applies featured, comment-lock, and tag lifecycle changes with version checks', async () => {
    const created = await createCommunityWork(db, {
      actor: user, designId, expectedDesignRevision: 1, title: '精选与评论锁作品', licenseVersion: COMMUNITY_LICENSE_VERSION,
    });
    const pending = await submitCommunityRevision(db, {
      actor: user, revisionId: created.revision.id, expectedVersion: created.revision.version,
    });
    await reviewCommunityRevision(db, {
      actor: moderator, revisionId: pending.id, expectedVersion: pending.version,
      decision: 'published', reason: '审核通过用于状态操作', requestId: 'publish-actions',
    });

    let [work] = await db.select().from(communityWorks).where(eq(communityWorks.id, created.work.id));
    work = await moderateCommunityWork(db, {
      actor: moderator, workId: work.id, action: 'feature', expectedVersion: work.version,
      reason: '人工选择本期精选', requestId: 'feature', now: new Date('2026-09-05T03:00:00Z'),
    });
    expect(work.featuredAt).toEqual(new Date('2026-09-05T03:00:00Z'));
    await expect(moderateCommunityWork(db, { actor: moderator, workId: work.id, action: 'feature', expectedVersion: work.version, reason: '重复精选应当拒绝', requestId: 'no-op-feature' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    work = await moderateCommunityWork(db, {
      actor: moderator, workId: work.id, action: 'lock_comments', expectedVersion: work.version,
      reason: '治理期间暂停评论', requestId: 'lock',
    });
    expect(work.commentsLocked).toBe(true);
    work = await moderateCommunityWork(db, {
      actor: moderator, workId: work.id, action: 'unlock_comments', expectedVersion: work.version,
      reason: '治理复核已经完成', requestId: 'unlock',
    });
    expect(work.commentsLocked).toBe(false);
    work = await moderateCommunityWork(db, {
      actor: moderator, workId: work.id, action: 'unfeature', expectedVersion: work.version,
      reason: '结束本期人工精选', requestId: 'unfeature',
    });
    expect(work.featuredAt).toBeNull();
    await expect(moderateCommunityWork(db, { actor: moderator, workId: work.id, action: 'unfeature', expectedVersion: work.version, reason: '重复取消精选应当拒绝', requestId: 'no-op-unfeature' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(moderateCommunityWork(db, {
      actor: moderator, workId: work.id, action: 'unlock_comments', expectedVersion: work.version,
      reason: '重复解锁应当拒绝', requestId: 'duplicate-unlock',
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    const tag = await createCommunityTag(db, {
      actor: moderator, name: '节日', slug: 'festival', sortOrder: 8,
      reason: '新增正式节日标签', requestId: 'tag-create',
    });
    await expect(createCommunityTag(db, { actor: moderator, name: '其他节日', slug: 'festival', reason: '重复链接标识', requestId: 'duplicate-slug' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(createCommunityTag(db, { actor: moderator, name: '节日', slug: 'other-festival', reason: '重复标签名称', requestId: 'duplicate-name' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(updateCommunityTag(db, { actor: moderator, tagId: tag.id, name: '动物', expectedVersion: tag.version, reason: '重复已有名称', requestId: 'duplicate-rename' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const updated = await updateCommunityTag(db, {
      actor: moderator, tagId: tag.id, expectedVersion: tag.version,
      name: '节庆', slug: 'celebration', sortOrder: 3, active: false,
      reason: '调整正式标签信息', requestId: 'tag-update',
    });
    expect(updated).toMatchObject({ name: '节庆', slug: 'celebration', sortOrder: 3, active: false, version: 2 });
  });
});
