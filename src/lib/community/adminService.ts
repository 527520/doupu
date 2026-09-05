import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDatabase } from '@/../db/client';
import {
  adminAuditLogs,
  communityRevisions,
  communityRevisionTags,
  communityTags,
  communityWorks,
} from '@/../db/schema';
import type { Actor } from '@/lib/auth/authorization';
import { sanitizeAuditState } from '@/lib/admin/audit';
import { AppError } from '@/lib/errors';

const reasonSchema = z.string().trim().min(3).max(500);
const tagNameSchema = z.string().trim().min(1).max(30);
const tagSlugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(50);
const tagOrderSchema = z.number().int().min(-2147483648).max(2147483647);

function rethrowTagConflict(error: unknown): never {
  const failure = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const constraint = failure.cause ?? failure;
  if (constraint.code === '23505' && constraint.constraint?.startsWith('community_tags_')) {
    throw new AppError('STATE_CONFLICT', '标签名称或链接标识已存在，请修改后重试');
  }
  throw error;
}

function reason(value: string): string {
  const parsed = reasonSchema.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION', '操作理由需为 3–500 个字符', 'reason');
  return parsed.data;
}

async function audit(tx: AnyDatabase, input: {
  actor: Actor;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  requestId: string;
  beforeState: unknown;
  afterState: unknown;
}) {
  await tx.insert(adminAuditLogs).values({
    actorUserId: input.actor.userId,
    actorRole: input.actor.role,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    requestId: input.requestId,
    beforeState: sanitizeAuditState(input.beforeState),
    afterState: sanitizeAuditState(input.afterState),
  });
}

export async function moderateCommunityWork(db: AnyDatabase, input: {
  actor: Actor;
  workId: string;
  action: 'remove' | 'restore' | 'feature' | 'unfeature' | 'lock_comments' | 'unlock_comments';
  expectedVersion: number;
  reason: string;
  requestId: string;
  now?: Date;
}) {
  const why = reason(input.reason);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [work] = await tx.select().from(communityWorks).where(eq(communityWorks.id, input.workId)).for('update');
    if (!work) throw new AppError('NOT_FOUND', '作品不存在');
    if (work.version !== input.expectedVersion) throw new AppError('STATE_CONFLICT', '作品状态已变化，请刷新后重试');
    const changes: Partial<typeof communityWorks.$inferInsert> = { version: work.version + 1, updatedAt: now };
    if (input.action === 'remove') {
      if (work.lifecycleStatus === 'removed') throw new AppError('STATE_CONFLICT', '作品已经下架');
      changes.lifecycleStatus = 'removed';
      changes.removedAt = now;
      changes.removedReason = why;
      await tx.update(communityRevisions).set({ status: 'withdrawn', withdrawnAt: now, updatedAt: now })
        .where(and(eq(communityRevisions.workId, work.id), inArray(communityRevisions.status, ['draft', 'pending_review'])));
    } else if (input.action === 'restore') {
      if (work.lifecycleStatus === 'active') throw new AppError('STATE_CONFLICT', '作品已经公开');
      let revisionId = work.currentPublishedRevisionId;
      let [revision] = revisionId ? await tx.select().from(communityRevisions).where(eq(communityRevisions.id, revisionId)) : [];
      if (!revision || !['published', 'superseded'].includes(revision.status)) {
        [revision] = await tx.select().from(communityRevisions).where(and(
          eq(communityRevisions.workId, work.id),
          inArray(communityRevisions.status, ['published', 'superseded']),
        )).orderBy(desc(communityRevisions.revisionNumber)).limit(1);
      }
      if (!revision) throw new AppError('STATE_CONFLICT', '作品没有可恢复的已批准版本');
      revisionId = revision.id;
      await tx.update(communityRevisions).set({
        status: 'superseded',
        version: sql`${communityRevisions.version} + 1`,
        updatedAt: now,
      }).where(and(
        eq(communityRevisions.workId, work.id),
        eq(communityRevisions.status, 'published'),
        ne(communityRevisions.id, revision.id),
      ));
      if (revision.status !== 'published') {
        await tx.update(communityRevisions).set({ status: 'published', version: revision.version + 1, updatedAt: now })
          .where(eq(communityRevisions.id, revision.id));
      }
      changes.lifecycleStatus = 'active';
      changes.currentPublishedRevisionId = revisionId;
      changes.withdrawnAt = null;
      changes.removedAt = null;
      changes.removedReason = null;
    } else if (input.action === 'feature' || input.action === 'unfeature') {
      if (Boolean(work.featuredAt) === (input.action === 'feature')) throw new AppError('STATE_CONFLICT', '精选状态未变化');
      if (input.action === 'feature' && (work.lifecycleStatus !== 'active' || !work.currentPublishedRevisionId)) {
        throw new AppError('STATE_CONFLICT', '只有公开作品可以精选');
      }
      changes.featuredAt = input.action === 'feature' ? now : null;
      changes.featuredByUserId = input.action === 'feature' ? input.actor.userId : null;
    } else {
      const locked = input.action === 'lock_comments';
      if (work.commentsLocked === locked) throw new AppError('STATE_CONFLICT', locked ? '评论已经锁定' : '评论已经解锁');
      changes.commentsLocked = locked;
    }
    const [updated] = await tx.update(communityWorks).set(changes)
      .where(and(eq(communityWorks.id, work.id), eq(communityWorks.version, work.version))).returning();
    if (!updated) throw new AppError('STATE_CONFLICT', '作品状态已变化，请刷新后重试');
    await audit(tx, {
      actor: input.actor,
      action: `community.work_${input.action}`,
      targetType: 'community_work',
      targetId: work.id,
      reason: why,
      requestId: input.requestId,
      beforeState: { lifecycleStatus: work.lifecycleStatus, revision: work.version, featured: Boolean(work.featuredAt), commentsLocked: work.commentsLocked },
      afterState: { lifecycleStatus: updated.lifecycleStatus, revision: updated.version, featured: Boolean(updated.featuredAt), commentsLocked: updated.commentsLocked },
    });
    return updated;
  });
}

export async function createCommunityTag(db: AnyDatabase, input: {
  actor: Actor;
  name: string;
  slug: string;
  sortOrder?: number;
  reason: string;
  requestId: string;
}) {
  const name = tagNameSchema.safeParse(input.name);
  const slug = tagSlugSchema.safeParse(input.slug);
  if (!name.success || !slug.success) throw new AppError('VALIDATION', '标签名称或 slug 无效');
  const why = reason(input.reason);
  const sortOrder = tagOrderSchema.parse(input.sortOrder ?? 0);
  return db.transaction(async (tx) => {
    const [tag] = await tx.insert(communityTags).values({
      name: name.data, slug: slug.data, sortOrder,
    }).onConflictDoNothing().returning();
    if (!tag) throw new AppError('STATE_CONFLICT', '标签名称或链接标识已存在，请修改后重试');
    await audit(tx, { actor: input.actor, action: 'community.tag_created', targetType: 'community_tag', targetId: tag.id, reason: why, requestId: input.requestId, beforeState: null, afterState: { revision: tag.version } });
    return tag;
  });
}

export async function updateCommunityTag(db: AnyDatabase, input: {
  actor: Actor;
  tagId: string;
  expectedVersion: number;
  name?: string;
  slug?: string;
  sortOrder?: number;
  active?: boolean;
  reason: string;
  requestId: string;
}) {
  const why = reason(input.reason);
  const name = input.name === undefined ? undefined : tagNameSchema.parse(input.name);
  const slug = input.slug === undefined ? undefined : tagSlugSchema.parse(input.slug);
  const sortOrder = input.sortOrder === undefined ? undefined : tagOrderSchema.parse(input.sortOrder);
  return db.transaction(async (tx) => {
    const [tag] = await tx.select().from(communityTags).where(eq(communityTags.id, input.tagId)).for('update');
    if (!tag) throw new AppError('NOT_FOUND', '标签不存在');
    if (tag.version !== input.expectedVersion || tag.mergedIntoTagId) throw new AppError('STATE_CONFLICT', '标签状态已变化');
    const [updated] = await tx.update(communityTags).set({
      name, slug, sortOrder, active: input.active,
      version: tag.version + 1, updatedAt: new Date(),
    }).where(and(eq(communityTags.id, tag.id), eq(communityTags.version, tag.version))).returning();
    if (!updated) throw new AppError('STATE_CONFLICT', '标签状态已变化');
    await audit(tx, { actor: input.actor, action: 'community.tag_updated', targetType: 'community_tag', targetId: tag.id, reason: why, requestId: input.requestId, beforeState: { revision: tag.version, mergedIntoTagId: tag.mergedIntoTagId }, afterState: { revision: updated.version, mergedIntoTagId: updated.mergedIntoTagId } });
    return updated;
  }).catch(rethrowTagConflict);
}

export async function mergeCommunityTag(db: AnyDatabase, input: {
  actor: Actor;
  sourceTagId: string;
  targetTagId: string;
  expectedVersion: number;
  reason: string;
  requestId: string;
}) {
  if (input.sourceTagId === input.targetTagId) throw new AppError('VALIDATION', '不能把标签合并到自身');
  const why = reason(input.reason);
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(communityTags).where(inArray(communityTags.id, [input.sourceTagId, input.targetTagId])).orderBy(communityTags.id).for('update');
    const source = rows.find((tag) => tag.id === input.sourceTagId);
    const target = rows.find((tag) => tag.id === input.targetTagId);
    if (!source || !target || !target.active || target.mergedIntoTagId) throw new AppError('NOT_FOUND', '源标签或目标标签不存在');
    if (source.version !== input.expectedVersion || source.mergedIntoTagId) throw new AppError('STATE_CONFLICT', '源标签状态已变化');
    const links = await tx.select({ revisionId: communityRevisionTags.revisionId }).from(communityRevisionTags)
      .where(eq(communityRevisionTags.tagId, source.id));
    if (links.length > 0) {
      await tx.insert(communityRevisionTags).values(links.map((link) => ({ revisionId: link.revisionId, tagId: target.id })))
        .onConflictDoNothing();
      await tx.delete(communityRevisionTags).where(eq(communityRevisionTags.tagId, source.id));
    }
    const [updated] = await tx.update(communityTags).set({
      active: false,
      mergedIntoTagId: target.id,
      version: source.version + 1,
      updatedAt: new Date(),
    }).where(and(eq(communityTags.id, source.id), eq(communityTags.version, source.version))).returning();
    if (!updated) throw new AppError('STATE_CONFLICT', '源标签状态已变化');
    await audit(tx, { actor: input.actor, action: 'community.tag_merged', targetType: 'community_tag', targetId: source.id, reason: why, requestId: input.requestId, beforeState: { revision: source.version, mergedIntoTagId: null }, afterState: { revision: updated.version, mergedIntoTagId: target.id } });
    return updated;
  });
}
