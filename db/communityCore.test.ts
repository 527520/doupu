import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from './testClient';
import {
  adminAuditLogs,
  communityOriginals,
  communityRevisions,
  communityTags,
  communityWorks,
  communityWorkTags,
  designs,
  users,
} from './schema';
import { attachTestOriginal, TEST_PNG } from './testOriginals';
import { createMemoryOriginalStore } from '@/lib/community/originalStore';
import { expireBlockedOriginals, purgeDeletedOriginals, readRevisionOriginal, resolveOriginalAccess } from '@/lib/community/originals';
import { reuseCommunityWork } from '@/lib/community/interactions';
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
  addTagsToCommunityWorks,
  createCommunityTag,
  mergeCommunityTag,
  moderateCommunityWork,
  setCommunityWorkTags,
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
      actor: user, designId, expectedDesignRevision: 1, title: '红色小猫', licenseVersion: COMMUNITY_LICENSE_VERSION,
    });
    expect(created.revision.status).toBe('draft');
    await db.update(designs).set({ project: project('changed', '#00FF00') }).where(eq(designs.id, designId));
    expect(JSON.stringify(created.revision.snapshot)).toContain('#FF0000');

    // D49：没有原图不能提交审核；上传后才允许
    await expect(submitCommunityRevision(db, { actor: user, revisionId: created.revision.id, expectedVersion: 1 })).rejects.toMatchObject({ code: 'ORIGINAL_REQUIRED' });
    const store = createMemoryOriginalStore();
    const original = await attachTestOriginal(db, user, created.revision.id, store);
    expect(original).toMatchObject({ mimeType: 'image/png', width: 1, height: 1 });
    expect(store.objects.size).toBe(1);
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
    // 修改再投稿沿用上一版原图：共享对象键，不必再次上传
    expect(replacement.originalInherited).toBe(true);
    const inherited = await db.select().from(communityOriginals).where(eq(communityOriginals.revisionId, replacement.id));
    expect(inherited).toHaveLength(1);
    expect(inherited[0].cosKey).toBe((await db.select().from(communityOriginals).where(eq(communityOriginals.revisionId, created.revision.id)))[0].cosKey);
    const replacementPending = await submitCommunityRevision(db, {
      actor: user, revisionId: replacement.id, expectedVersion: replacement.version,
    });
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, created.work.id)))[0].currentPublishedRevisionId).toBe(published.id);

    const secondReview = await reviewCommunityRevision(db, {
      actor: moderator, revisionId: replacement.id, expectedVersion: replacementPending.version,
      decision: 'published', reason: '修改版审核通过', requestId: 'review-2',
    });
    const revisions = await db.select().from(communityRevisions).where(eq(communityRevisions.workId, created.work.id));
    expect(revisions.sort((a, b) => a.revisionNumber - b.revisionNumber).map((revision) => [revision.revisionNumber, revision.status])).toEqual([[1, 'superseded'], [2, 'published']]);
    expect(await db.select().from(adminAuditLogs)).toHaveLength(2);
    // 被替代且无人引用的旧版原图标记删除；对象仍被新版引用，因此清理时不删对象
    const retired = (await db.select().from(communityOriginals).where(eq(communityOriginals.revisionId, created.revision.id)))[0];
    expect(retired.deletedAt).not.toBeNull();
    expect(secondReview.purgeKeys).toEqual([retired.cosKey]);
    expect(await purgeDeletedOriginals(db, store, { keys: secondReview.purgeKeys })).toEqual({ purged: 1, failed: 0 });
    expect(store.objects.size).toBe(1);
  });

  it('withdraws the work and any pending revision without deleting approval facts', async () => {
    const created = await createCommunityWork(db, {
      actor: user, designId, expectedDesignRevision: 1, title: '待撤回作品', licenseVersion: COMMUNITY_LICENSE_VERSION,
    });
    const store = createMemoryOriginalStore();
    await attachTestOriginal(db, user, created.revision.id, store);
    const pending = await submitCommunityRevision(db, { actor: user, revisionId: created.revision.id, expectedVersion: 1 });
    const withdrawn = await withdrawCommunityWork(db, { actor: user, workId: created.work.id, expectedVersion: 1 });
    expect(withdrawn.lifecycleStatus).toBe('withdrawn');
    expect((await db.select().from(communityRevisions).where(eq(communityRevisions.id, pending.id)))[0].status).toBe('withdrawn');
    // 作者撤回：原图立即不可取回，对象在清理后消失
    expect(withdrawn.purgeKeys).toHaveLength(1);
    await expect(resolveOriginalAccess(db, user, created.revision.id)).resolves.toBeNull();
    await purgeDeletedOriginals(db, store, { keys: withdrawn.purgeKeys });
    expect(store.objects.size).toBe(0);
  });

  it('grants original access to author, moderators and reusers only, and blocks it while removed', async () => {
    const created = await createCommunityWork(db, { actor: user, designId, expectedDesignRevision: 1, title: '原图权限', licenseVersion: COMMUNITY_LICENSE_VERSION });
    const store = createMemoryOriginalStore();
    // 非作者不能上传
    await expect(attachTestOriginal(db, moderator, created.revision.id, store)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await attachTestOriginal(db, user, created.revision.id, store);
    const pending = await submitCommunityRevision(db, { actor: user, revisionId: created.revision.id, expectedVersion: 1 });
    // 已提交后不能再替换
    await expect(attachTestOriginal(db, user, created.revision.id, store)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await reviewCommunityRevision(db, { actor: moderator, revisionId: pending.id, expectedVersion: pending.version, decision: 'published', reason: '审核通过用于原图权限测试', requestId: 'review-original' });
    const [stranger] = await db.insert(users).values({ email: 'stranger@example.com', username: 'S', passwordHash: 'hash', emailVerifiedAt: new Date() }).returning();
    const strangerActor: Actor = { userId: stranger.id, role: 'user', accountStatus: 'active', emailVerified: true };
    expect((await resolveOriginalAccess(db, user, created.revision.id))?.access).toBe('author');
    expect((await resolveOriginalAccess(db, moderator, created.revision.id))?.access).toBe('moderator');
    expect(await resolveOriginalAccess(db, strangerActor, created.revision.id)).toBeNull();
    expect(await resolveOriginalAccess(db, null, created.revision.id)).toBeNull();
    await reuseCommunityWork(db, { actor: strangerActor, workId: created.work.id });
    expect((await resolveOriginalAccess(db, strangerActor, created.revision.id))?.access).toBe('reuser');
    const read = await readRevisionOriginal(db, store, strangerActor, created.revision.id);
    expect(read.contentType).toBe('image/png');
    expect(read.body.equals(TEST_PNG)).toBe(true);

    // 管理员下架：作者与引用者被封禁，审核员仍可查看；恢复即解封
    let [work] = await db.select().from(communityWorks).where(eq(communityWorks.id, created.work.id));
    work = await moderateCommunityWork(db, { actor: moderator, workId: work.id, action: 'remove', expectedVersion: work.version, reason: '治理下架用于原图封禁测试', requestId: 'remove-original' });
    expect(await resolveOriginalAccess(db, user, created.revision.id)).toBeNull();
    expect(await resolveOriginalAccess(db, strangerActor, created.revision.id)).toBeNull();
    expect((await resolveOriginalAccess(db, moderator, created.revision.id))?.access).toBe('moderator');
    await moderateCommunityWork(db, { actor: moderator, workId: work.id, action: 'restore', expectedVersion: work.version, reason: '复核后恢复公开', requestId: 'restore-original' });
    expect((await resolveOriginalAccess(db, user, created.revision.id))?.access).toBe('author');
    // 逾期未恢复的下架原图由维护任务删除
    [work] = await db.select().from(communityWorks).where(eq(communityWorks.id, created.work.id));
    await moderateCommunityWork(db, { actor: moderator, workId: work.id, action: 'remove', expectedVersion: work.version, reason: '再次下架验证逾期删除', requestId: 'remove-original-2', now: new Date('2026-01-01T00:00:00Z') });
    expect(await expireBlockedOriginals(db, store, new Date('2026-02-15T00:00:00Z'))).toEqual({ expired: 1, purged: 1, failed: 0 });
    expect(store.objects.size).toBe(0);
    expect(await resolveOriginalAccess(db, moderator, created.revision.id)).toBeNull();
  });

  it('moves tag links atomically and restores the last approved work revision', async () => {
    const created = await createCommunityWork(db, {
      actor: user, designId, expectedDesignRevision: 1, title: '治理作品', licenseVersion: COMMUNITY_LICENSE_VERSION,
    });
    const [initialWork] = await db.select().from(communityWorks).where(eq(communityWorks.id, created.work.id));
    const tagged = await setCommunityWorkTags(db, { actor: moderator, workId: created.work.id, expectedVersion: initialWork.version, tags: ['动物'], requestId: 'tag-set' });
    expect(tagged.tags).toEqual([{ id: tagId, name: '动物' }]);
    await attachTestOriginal(db, user, created.revision.id);
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
    expect(await db.select().from(communityWorkTags)).toMatchObject([{ workId: created.work.id, tagId: target.id }]);
  });

  it('creates tags on the fly, replaces the whole set, follows merges and bulk-adds without a typed reason', async () => {
    const first = await createCommunityWork(db, { actor: user, designId, expectedDesignRevision: 1, title: '标签作品一', licenseVersion: COMMUNITY_LICENSE_VERSION });
    const [secondDesign] = await db.insert(designs).values({ id: crypto.randomUUID(), userId: user.userId, name: 'second', project: project('second'), payloadBytes: 1 }).returning();
    const second = await createCommunityWork(db, { actor: user, designId: secondDesign.id, expectedDesignRevision: 1, title: '标签作品二', licenseVersion: COMMUNITY_LICENSE_VERSION });
    let [work] = await db.select().from(communityWorks).where(eq(communityWorks.id, first.work.id));
    const set = await setCommunityWorkTags(db, { actor: moderator, workId: work.id, expectedVersion: work.version, tags: [' 星星人 ', '星星人', '动物'], requestId: 'set-1' });
    expect(set.tags.map((tag) => tag.name)).toEqual(['星星人', '动物']);
    expect(set.version).toBe(work.version + 1);
    const created = await db.select().from(communityTags).where(eq(communityTags.name, '星星人'));
    expect(created).toHaveLength(1);
    expect(created[0].slug).toMatch(/^t-[0-9a-f]{12}$/u);
    const audits = await db.select().from(adminAuditLogs);
    expect(audits.filter((log) => log.action === 'community.tag_created')).toHaveLength(1);
    expect(audits.find((log) => log.action === 'community.work_tags_updated')).toMatchObject({ reason: '标签调整', afterState: { count: 2 } });

    // 同一集合再保存一次：不改版本、不写审计
    [work] = await db.select().from(communityWorks).where(eq(communityWorks.id, first.work.id));
    const unchanged = await setCommunityWorkTags(db, { actor: moderator, workId: work.id, expectedVersion: work.version, tags: ['星星人', '动物'], requestId: 'set-2' });
    expect(unchanged.version).toBe(work.version);
    expect((await db.select().from(adminAuditLogs)).filter((log) => log.action === 'community.work_tags_updated')).toHaveLength(1);

    // 合并后按旧名打标落到终点标签
    const [pets] = await db.insert(communityTags).values({ name: '宠物', slug: 'pets' }).returning();
    const [animals] = await db.select().from(communityTags).where(eq(communityTags.id, tagId));
    await mergeCommunityTag(db, { actor: moderator, sourceTagId: tagId, targetTagId: pets.id, expectedVersion: animals.version, reason: '动物并入宠物', requestId: 'merge-2' });
    const bulk = await addTagsToCommunityWorks(db, { actor: moderator, workIds: [first.work.id, second.work.id], tags: ['动物'], requestId: 'bulk-1' });
    expect(bulk.tags).toEqual([{ id: pets.id, name: '宠物' }]);
    expect(new Map(bulk.works.map((entry) => [entry.workId, entry.added]))).toEqual(new Map([[first.work.id, 0], [second.work.id, 1]]));
    const links = await db.select().from(communityWorkTags).where(eq(communityWorkTags.workId, second.work.id));
    expect(links).toMatchObject([{ tagId: pets.id, assignedByUserId: moderator.userId }]);

    await expect(setCommunityWorkTags(db, { actor: moderator, workId: first.work.id, expectedVersion: 1, tags: ['x'], requestId: 'stale' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    [work] = await db.select().from(communityWorks).where(eq(communityWorks.id, first.work.id));
    await expect(setCommunityWorkTags(db, { actor: moderator, workId: first.work.id, expectedVersion: work.version, tags: Array.from({ length: 11 }, (_, i) => `标签${i}`), requestId: 'too-many' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('applies featured, comment-lock, and tag lifecycle changes with version checks', async () => {
    const created = await createCommunityWork(db, {
      actor: user, designId, expectedDesignRevision: 1, title: '精选与评论锁作品', licenseVersion: COMMUNITY_LICENSE_VERSION,
    });
    await attachTestOriginal(db, user, created.revision.id);
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
      actor: moderator, name: '节日', sortOrder: 8,
      reason: '新增正式节日标签', requestId: 'tag-create',
    });
    expect(tag.slug).toMatch(/^t-[0-9a-f]{12}$/u);
    await expect(createCommunityTag(db, { actor: moderator, name: '其他节日', slug: tag.slug, reason: '重复链接标识', requestId: 'duplicate-slug' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
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
