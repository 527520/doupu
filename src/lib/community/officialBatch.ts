import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDatabase } from '@/../db/client';
import { adminAuditLogs, communityRevisions, communityWorks, officialBatches } from '@/../db/schema';
import type { Actor } from '@/lib/auth/authorization';
import { sanitizeAuditState } from '@/lib/admin/audit';
import { AppError } from '@/lib/errors';
import { generationParamsSchema } from '@/lib/schemas';
import { communityPreviewSchema, communitySnapshotSchema, COMMUNITY_LICENSE_VERSION, deriveCommunityPreview, snapshotColorCount, snapshotPaletteIdentity } from './snapshot';

const reasonSchema = z.string().trim().min(3).max(500);
const titleSchema = z.string().trim().min(1).max(80);
export const officialBatchDefaultParamsSchema = generationParamsSchema;

export async function createOfficialBatch(db: AnyDatabase, input: {
  actor: Actor; itemCount: number; defaultParams: unknown; engineVersion: string; reason: string; requestId: string; now?: Date;
}) {
  if (!Number.isInteger(input.itemCount) || input.itemCount < 1 || input.itemCount > 50) throw new AppError('VALIDATION', '单批文件数需为 1–50');
  if (!input.engineVersion.trim() || input.engineVersion.length > 80) throw new AppError('VALIDATION', '引擎版本无效');
  const defaultParams = officialBatchDefaultParamsSchema.safeParse(input.defaultParams);
  if (!defaultParams.success) throw new AppError('VALIDATION', '批次默认参数无效', 'defaultParams');
  const reason = reasonSchema.parse(input.reason);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [batch] = await tx.insert(officialBatches).values({
      status: 'running', itemCount: input.itemCount, defaultParams: defaultParams.data,
      engineVersion: input.engineVersion, adminUserId: input.actor.userId,
      startedAt: now, createdAt: now, updatedAt: now,
    }).returning();
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actor.userId, actorRole: input.actor.role,
      action: 'official.batch_started', targetType: 'official_batch', targetId: batch.id,
      reason, requestId: input.requestId, beforeState: null,
      afterState: sanitizeAuditState({ status: batch.status, version: batch.version }),
    });
    return batch;
  });
}

export async function saveOfficialDraft(db: AnyDatabase, input: {
  actor: Actor; batchId: string; title: string; snapshot: unknown; reason: string; requestId: string; now?: Date;
}) {
  const title = titleSchema.safeParse(input.title);
  const snapshot = communitySnapshotSchema.safeParse(input.snapshot);
  if (!title.success || !snapshot.success) throw new AppError('VALIDATION', '官方草稿标题或图纸无效');
  const reason = reasonSchema.parse(input.reason);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(officialBatches).where(eq(officialBatches.id, input.batchId)).for('update');
    if (!batch || batch.adminUserId !== input.actor.userId) throw new AppError('NOT_FOUND', '批次不存在');
    if (!['running', 'paused'].includes(batch.status)) throw new AppError('STATE_CONFLICT', '批次当前不能保存草稿');
    if (batch.successCount >= batch.itemCount) throw new AppError('STATE_CONFLICT', '批次成功项已达到文件总数');
    const [work] = await tx.insert(communityWorks).values({ authorUserId: input.actor.userId, authorType: 'official', createdAt: now, updatedAt: now }).returning();
    const palette = snapshotPaletteIdentity(snapshot.data);
    const [revision] = await tx.insert(communityRevisions).values({
      workId: work.id, revisionNumber: 1, status: 'draft', title: title.data,
      authorType: 'official', publicAuthorId: 'doupu-official', frozenDisplayName: '豆谱官方',
      officialBatchId: batch.id, licenseVersion: COMMUNITY_LICENSE_VERSION, licenseConfirmedAt: now,
      engineVersion: snapshot.data.engineVersion, boardProfile: snapshot.data.boardProfile,
      paletteKind: palette.kind, paletteId: palette.id,
      width: snapshot.data.pattern.width, height: snapshot.data.pattern.height,
      colorCount: snapshotColorCount(snapshot.data), snapshot: snapshot.data,
      preview: deriveCommunityPreview(snapshot.data.pattern), createdAt: now, updatedAt: now,
    }).returning();
    await tx.update(officialBatches).set({ successCount: sql`${officialBatches.successCount} + 1`, updatedAt: now })
      .where(eq(officialBatches.id, batch.id));
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actor.userId, actorRole: input.actor.role,
      action: 'official.draft_saved', targetType: 'community_revision', targetId: revision.id,
      reason, requestId: input.requestId, beforeState: null,
      afterState: sanitizeAuditState({ revisionStatus: revision.status, revision: revision.version }),
    });
    return { batchId: batch.id, workId: work.id, revisionId: revision.id, status: revision.status };
  });
}

export async function transitionOfficialBatch(db: AnyDatabase, input: {
  actor: Actor; batchId: string; action: 'pause' | 'resume' | 'cancel'; expectedVersion: number;
  reason: string; requestId: string; now?: Date;
}) {
  const reason = reasonSchema.parse(input.reason);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(officialBatches).where(eq(officialBatches.id, input.batchId)).for('update');
    if (!batch || batch.adminUserId !== input.actor.userId) throw new AppError('NOT_FOUND', '批次不存在');
    if (batch.version !== input.expectedVersion) throw new AppError('STATE_CONFLICT', '批次版本已变化');
    const next = input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'running' : 'cancelled';
    const allowed = (input.action === 'pause' && batch.status === 'running')
      || (input.action === 'resume' && batch.status === 'paused')
      || (input.action === 'cancel' && ['running', 'paused'].includes(batch.status));
    if (!allowed) throw new AppError('STATE_CONFLICT', '批次状态不能执行此操作');
    const [updated] = await tx.update(officialBatches).set({
      status: next, version: batch.version + 1, updatedAt: now,
      completedAt: next === 'cancelled' ? now : null,
      failureCount: next === 'cancelled' ? Math.max(0, batch.itemCount - batch.successCount) : batch.failureCount,
    }).where(and(eq(officialBatches.id, batch.id), eq(officialBatches.version, batch.version))).returning();
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actor.userId, actorRole: input.actor.role,
      action: `official.batch_${input.action}`, targetType: 'official_batch', targetId: batch.id,
      reason, requestId: input.requestId,
      beforeState: sanitizeAuditState({ status: batch.status, version: batch.version }),
      afterState: sanitizeAuditState({ status: updated.status, version: updated.version }),
    });
    return updated;
  });
}

export async function publishOfficialBatch(db: AnyDatabase, input: {
  actor: Actor; batchId: string; revisionIds: string[]; expectedVersion: number;
  reason: string; requestId: string; now?: Date;
}) {
  const revisionIds = [...new Set(input.revisionIds)];
  if (revisionIds.length < 1 || revisionIds.length > 50) throw new AppError('VALIDATION', '请选择 1–50 个合法官方草稿');
  const reason = reasonSchema.parse(input.reason);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(officialBatches).where(eq(officialBatches.id, input.batchId)).for('update');
    if (!batch || batch.adminUserId !== input.actor.userId) throw new AppError('NOT_FOUND', '批次不存在');
    if (batch.version !== input.expectedVersion || !['running', 'paused'].includes(batch.status)) throw new AppError('STATE_CONFLICT', '批次状态已变化');
    const drafts = await tx.select().from(communityRevisions).where(and(
      eq(communityRevisions.officialBatchId, batch.id), eq(communityRevisions.status, 'draft'),
      eq(communityRevisions.authorType, 'official'), inArray(communityRevisions.id, revisionIds),
    )).for('update');
    if (drafts.length !== revisionIds.length) throw new AppError('STATE_CONFLICT', '所选草稿包含无效或已发布项目');
    for (const draft of drafts) {
      await tx.update(communityRevisions).set({
        status: 'published', version: draft.version + 1, reviewedAt: now,
        reviewedByUserId: input.actor.userId, reviewReason: reason, publishedAt: now, updatedAt: now,
      }).where(eq(communityRevisions.id, draft.id));
      await tx.update(communityWorks).set({ currentPublishedRevisionId: draft.id, version: sql`${communityWorks.version} + 1`, updatedAt: now })
        .where(eq(communityWorks.id, draft.workId));
      await tx.insert(adminAuditLogs).values({
        actorUserId: input.actor.userId, actorRole: input.actor.role,
        action: 'official.revision_published', targetType: 'community_revision', targetId: draft.id,
        reason, requestId: input.requestId,
        beforeState: sanitizeAuditState({ revisionStatus: draft.status, revision: draft.version }),
        afterState: sanitizeAuditState({ revisionStatus: 'published', revision: draft.version + 1 }),
      });
    }
    const [updated] = await tx.update(officialBatches).set({
      status: 'completed', version: batch.version + 1, completedAt: now, updatedAt: now,
      failureCount: Math.max(0, batch.itemCount - batch.successCount),
    }).where(eq(officialBatches.id, batch.id)).returning();
    return { batch: updated, publishedRevisionIds: revisionIds };
  });
}

export async function listOfficialBatches(db: AnyDatabase, actorUserId: string) {
  const batches = await db.select().from(officialBatches).where(eq(officialBatches.adminUserId, actorUserId))
    .orderBy(desc(officialBatches.createdAt)).limit(50);
  if (batches.length === 0) return [];
  const revisions = await db.select({
    id: communityRevisions.id, workId: communityRevisions.workId, officialBatchId: communityRevisions.officialBatchId,
    title: communityRevisions.title, status: communityRevisions.status,
    preview: communityRevisions.preview, width: communityRevisions.width, height: communityRevisions.height,
  }).from(communityRevisions).where(inArray(communityRevisions.officialBatchId, batches.map((batch) => batch.id)));
  return batches.map((batch) => ({
    ...batch, defaultParams: batch.defaultParams,
    startedAt: batch.startedAt?.toISOString() ?? null, completedAt: batch.completedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(), updatedAt: batch.updatedAt.toISOString(),
    drafts: revisions.filter((revision) => revision.officialBatchId === batch.id).flatMap((revision) => {
      const preview = communityPreviewSchema.safeParse(revision.preview);
      return preview.success ? [{ ...revision, preview: preview.data }] : [];
    }),
  }));
}
