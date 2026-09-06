import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDatabase } from '@/../db/client';
import {
  adminAuditLogs,
  communityRevisions,
  communityRevisionTags,
  communityTags,
  communityWorks,
  communityWorkTags,
} from '@/../db/schema';
import type { Actor } from '@/lib/auth/authorization';
import { sanitizeAuditState } from '@/lib/admin/audit';
import { AppError } from '@/lib/errors';
import { blockWorkOriginals, unblockWorkOriginals } from './originals';
import { deriveTagSlug, isValidTagName, normalizeTagName, WORK_TAG_LIMIT } from './tagNames';

const reasonSchema = z.string().trim().min(3).max(500);
const tagSlugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(50);
const tagOrderSchema = z.number().int().min(-2147483648).max(2147483647);
/** 打标是高频低风险操作：允许不填理由，审计仍然记录并使用这条默认理由。 */
export const DEFAULT_TAGGING_REASON = '标签调整';

function tagName(raw: string): string {
  const name = normalizeTagName(raw);
  if (!isValidTagName(name)) throw new AppError('VALIDATION', '标签名称需为 1–30 个字符，且不能包含控制字符或尖括号', 'name');
  return name;
}

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
      // 下架先封禁原图访问；保留期内恢复即解封，逾期由维护任务删除对象。
      await blockWorkOriginals(tx, work.id, now);
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
      await unblockWorkOriginals(tx, work.id);
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
  slug?: string;
  sortOrder?: number;
  reason: string;
  requestId: string;
}) {
  const name = tagName(input.name);
  const slug = input.slug === undefined || input.slug === '' ? deriveTagSlug(name) : tagSlugSchema.parse(input.slug);
  const why = reason(input.reason);
  const sortOrder = tagOrderSchema.parse(input.sortOrder ?? 0);
  return db.transaction(async (tx) => {
    const [tag] = await tx.insert(communityTags).values({ name, slug, sortOrder }).onConflictDoNothing().returning();
    if (!tag) throw new AppError('STATE_CONFLICT', '标签名称已存在，请直接使用现有标签');
    await audit(tx, { actor: input.actor, action: 'community.tag_created', targetType: 'community_tag', targetId: tag.id, reason: why, requestId: input.requestId, beforeState: null, afterState: { revision: tag.version } });
    return tag;
  });
}

/**
 * 按名称解析标签：现有（含已合并指向终点、大小写不敏感）直接复用，
 * 不存在的就地创建。返回去重后的终点标签 ID，顺序与输入一致。
 */
async function resolveTagIdsByName(tx: AnyDatabase, actor: Actor, names: string[], requestId: string): Promise<Array<{ id: string; name: string }>> {
  const normalized = [...new Set(names.map(tagName))];
  if (normalized.length > WORK_TAG_LIMIT) throw new AppError('VALIDATION', `每件作品最多 ${WORK_TAG_LIMIT} 个标签`, 'tags');
  if (normalized.length === 0) return [];
  const lowered = normalized.map((name) => name.toLocaleLowerCase('zh-CN'));
  const rows = await tx.select({ id: communityTags.id, name: communityTags.name, active: communityTags.active, mergedIntoTagId: communityTags.mergedIntoTagId })
    .from(communityTags).where(inArray(sql`lower(${communityTags.name})`, lowered));
  const byLower = new Map(rows.map((row) => [row.name.toLocaleLowerCase('zh-CN'), row]));
  const resolved: Array<{ id: string; name: string }> = [];
  for (const name of normalized) {
    let row = byLower.get(name.toLocaleLowerCase('zh-CN'));
    // 沿合并链走到终点，避免把作品挂到已停用的旧标签上。
    for (let hops = 0; row?.mergedIntoTagId && hops < 10; hops += 1) {
      const [next] = await tx.select({ id: communityTags.id, name: communityTags.name, active: communityTags.active, mergedIntoTagId: communityTags.mergedIntoTagId })
        .from(communityTags).where(eq(communityTags.id, row.mergedIntoTagId));
      if (!next) break;
      row = next;
    }
    if (row && !row.active && !row.mergedIntoTagId) throw new AppError('VALIDATION', `标签「${row.name}」已停用，请先在标签管理中启用`, 'tags');
    if (!row) {
      const [created] = await tx.insert(communityTags).values({ name, slug: deriveTagSlug(name) }).onConflictDoNothing().returning();
      if (created) {
        await audit(tx, { actor, action: 'community.tag_created', targetType: 'community_tag', targetId: created.id, reason: DEFAULT_TAGGING_REASON, requestId, beforeState: null, afterState: { revision: created.version } });
        row = { id: created.id, name: created.name, active: true, mergedIntoTagId: null };
      } else {
        const [existing] = await tx.select({ id: communityTags.id, name: communityTags.name, active: communityTags.active, mergedIntoTagId: communityTags.mergedIntoTagId })
          .from(communityTags).where(eq(sql`lower(${communityTags.name})`, name.toLocaleLowerCase('zh-CN')));
        if (!existing) throw new AppError('STATE_CONFLICT', '标签创建冲突，请重试');
        row = existing;
      }
    }
    if (!resolved.some((entry) => entry.id === row!.id)) resolved.push({ id: row.id, name: row.name });
  }
  return resolved;
}

/** 用一组标签名整体替换作品当前标签；名称不存在则创建。 */
export async function setCommunityWorkTags(db: AnyDatabase, input: {
  actor: Actor;
  workId: string;
  expectedVersion: number;
  tags: string[];
  reason?: string;
  requestId: string;
  now?: Date;
}) {
  const why = input.reason?.trim() ? reason(input.reason) : DEFAULT_TAGGING_REASON;
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [work] = await tx.select({ id: communityWorks.id, version: communityWorks.version }).from(communityWorks)
      .where(eq(communityWorks.id, input.workId)).for('update');
    if (!work) throw new AppError('NOT_FOUND', '作品不存在');
    if (work.version !== input.expectedVersion) throw new AppError('STATE_CONFLICT', '作品状态已变化，请刷新后重试');
    const target = await resolveTagIdsByName(tx, input.actor, input.tags, input.requestId);
    const current = await tx.select({ tagId: communityWorkTags.tagId }).from(communityWorkTags).where(eq(communityWorkTags.workId, work.id));
    const currentIds = new Set(current.map((row) => row.tagId));
    const targetIds = new Set(target.map((tag) => tag.id));
    const removed = [...currentIds].filter((id) => !targetIds.has(id));
    const added = target.filter((tag) => !currentIds.has(tag.id));
    if (removed.length > 0) await tx.delete(communityWorkTags).where(and(eq(communityWorkTags.workId, work.id), inArray(communityWorkTags.tagId, removed)));
    if (added.length > 0) {
      await tx.insert(communityWorkTags).values(added.map((tag) => ({ workId: work.id, tagId: tag.id, assignedByUserId: input.actor.userId, createdAt: now })))
        .onConflictDoNothing();
    }
    if (removed.length > 0 || added.length > 0) {
      const [updated] = await tx.update(communityWorks).set({ version: work.version + 1, updatedAt: now })
        .where(and(eq(communityWorks.id, work.id), eq(communityWorks.version, work.version))).returning();
      if (!updated) throw new AppError('STATE_CONFLICT', '作品状态已变化，请刷新后重试');
      await audit(tx, {
        actor: input.actor, action: 'community.work_tags_updated', targetType: 'community_work', targetId: work.id,
        reason: why, requestId: input.requestId,
        beforeState: { revision: work.version, count: currentIds.size },
        afterState: { revision: updated.version, count: targetIds.size },
      });
      return { workId: work.id, version: updated.version, tags: target };
    }
    return { workId: work.id, version: work.version, tags: target };
  });
}

/** 给多件作品追加同一组标签（批量打标）；已有的跳过，不修改其它标签。 */
export async function addTagsToCommunityWorks(db: AnyDatabase, input: {
  actor: Actor;
  workIds: string[];
  tags: string[];
  reason?: string;
  requestId: string;
  now?: Date;
}) {
  const why = input.reason?.trim() ? reason(input.reason) : DEFAULT_TAGGING_REASON;
  const now = input.now ?? new Date();
  const workIds = [...new Set(input.workIds)];
  if (workIds.length === 0 || workIds.length > 50) throw new AppError('VALIDATION', '一次最多为 50 件作品打标', 'workIds');
  return db.transaction(async (tx) => {
    const target = await resolveTagIdsByName(tx, input.actor, input.tags, input.requestId);
    if (target.length === 0) throw new AppError('VALIDATION', '请至少填写一个标签', 'tags');
    const works = await tx.select({ id: communityWorks.id, version: communityWorks.version }).from(communityWorks)
      .where(inArray(communityWorks.id, workIds)).orderBy(communityWorks.id).for('update');
    if (works.length !== workIds.length) throw new AppError('NOT_FOUND', '部分作品不存在');
    const updated: Array<{ workId: string; version: number; added: number }> = [];
    for (const work of works) {
      const existing = await tx.select({ tagId: communityWorkTags.tagId }).from(communityWorkTags).where(eq(communityWorkTags.workId, work.id));
      const existingIds = new Set(existing.map((row) => row.tagId));
      const additions = target.filter((tag) => !existingIds.has(tag.id));
      if (existingIds.size + additions.length > WORK_TAG_LIMIT) throw new AppError('VALIDATION', `作品标签超过 ${WORK_TAG_LIMIT} 个上限`, 'tags');
      if (additions.length === 0) { updated.push({ workId: work.id, version: work.version, added: 0 }); continue; }
      await tx.insert(communityWorkTags).values(additions.map((tag) => ({ workId: work.id, tagId: tag.id, assignedByUserId: input.actor.userId, createdAt: now }))).onConflictDoNothing();
      const [row] = await tx.update(communityWorks).set({ version: work.version + 1, updatedAt: now })
        .where(and(eq(communityWorks.id, work.id), eq(communityWorks.version, work.version))).returning();
      if (!row) throw new AppError('STATE_CONFLICT', '作品状态已变化，请刷新后重试');
      await audit(tx, {
        actor: input.actor, action: 'community.work_tags_updated', targetType: 'community_work', targetId: work.id,
        reason: why, requestId: input.requestId,
        beforeState: { revision: work.version, count: existingIds.size },
        afterState: { revision: row.version, count: existingIds.size + additions.length },
      });
      updated.push({ workId: work.id, version: row.version, added: additions.length });
    }
    return { tags: target, works: updated };
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
  const name = input.name === undefined ? undefined : tagName(input.name);
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
    const workLinks = await tx.select({ workId: communityWorkTags.workId, assignedByUserId: communityWorkTags.assignedByUserId })
      .from(communityWorkTags).where(eq(communityWorkTags.tagId, source.id));
    if (workLinks.length > 0) {
      await tx.insert(communityWorkTags).values(workLinks.map((link) => ({ workId: link.workId, tagId: target.id, assignedByUserId: link.assignedByUserId })))
        .onConflictDoNothing();
      await tx.delete(communityWorkTags).where(eq(communityWorkTags.tagId, source.id));
    }
    // 历史修订标签表已停写，但合并时仍迁移，保证旧行不再指向已合并标签。
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
