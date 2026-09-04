import { and, count, eq, inArray, max, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDatabase } from '@/../db/client';
import {
  adminAuditLogs,
  communityRevisions,
  communityRevisionTags,
  communityTags,
  communityWorks,
  designs,
  users,
} from '@/../db/schema';
import type { Actor } from '@/lib/auth/authorization';
import { resolvePublicDisplayName } from '@/lib/identity/publicAuthor';
import { sanitizeAuditState } from '@/lib/admin/audit';
import { AppError } from '@/lib/errors';
import {
  COMMUNITY_LICENSE_VERSION,
  communitySnapshotFromProject,
  deriveCommunityPreview,
  snapshotColorCount,
  snapshotPaletteIdentity,
} from './snapshot';

export const communityTitleSchema = z.string().trim().min(1).max(80);
const reasonSchema = z.string().trim().min(3).max(500);

interface CreateRevisionInput {
  actor: Actor;
  designId: string;
  title: string;
  licenseVersion: string;
  tagIds?: string[];
  now?: Date;
}

async function validatedTags(tx: AnyDatabase, tagIds: string[]): Promise<string[]> {
  const unique = [...new Set(tagIds)];
  if (unique.length > 10) throw new AppError('VALIDATION', '每个修订最多选择 10 个正式标签', 'tagIds');
  if (unique.length === 0) return [];
  const rows = await tx.select({ id: communityTags.id }).from(communityTags)
    .where(and(inArray(communityTags.id, unique), eq(communityTags.active, true)));
  if (rows.length !== unique.length) throw new AppError('VALIDATION', '标签不存在或已停用', 'tagIds');
  return unique;
}

async function authorIdentity(tx: AnyDatabase, actor: Actor, now: Date) {
  const [account] = await tx.select({
    id: users.id,
    email: users.email,
    username: users.username,
    publicAuthorId: users.publicAuthorId,
    accountStatus: users.accountStatus,
    emailVerifiedAt: users.emailVerifiedAt,
  }).from(users).where(eq(users.id, actor.userId)).for('update');
  if (!account || account.accountStatus !== 'active' || !account.emailVerifiedAt || !account.email) {
    throw new AppError('FORBIDDEN', '账号当前不能投稿');
  }
  let publicAuthorId = account.publicAuthorId;
  if (!publicAuthorId) {
    publicAuthorId = crypto.randomUUID();
    await tx.update(users).set({ publicAuthorId, updatedAt: now }).where(eq(users.id, account.id));
  }
  return { publicAuthorId, displayName: resolvePublicDisplayName(account.username, account.email) };
}

async function revisionPayload(tx: AnyDatabase, input: CreateRevisionInput) {
  const title = communityTitleSchema.safeParse(input.title);
  if (!title.success) throw new AppError('VALIDATION', '作品标题需为 1–80 个字符', 'title');
  if (input.licenseVersion !== COMMUNITY_LICENSE_VERSION) {
    throw new AppError('VALIDATION', '请确认当前版本的豆社有限平台许可', 'licenseVersion');
  }
  const [design] = await tx.select({ project: designs.project }).from(designs).where(and(
    eq(designs.id, input.designId),
    eq(designs.userId, input.actor.userId),
    sql`${designs.deletedAt} is null`,
  ));
  if (!design) throw new AppError('NOT_FOUND', '私人设计不存在');
  const snapshot = communitySnapshotFromProject(design.project);
  if (!snapshot) throw new AppError('VALIDATION', '设计图纸不符合豆社发布协议');
  const identity = await authorIdentity(tx, input.actor, input.now ?? new Date());
  const palette = snapshotPaletteIdentity(snapshot);
  const tagIds = await validatedTags(tx, input.tagIds ?? []);
  return {
    title: title.data,
    snapshot,
    preview: deriveCommunityPreview(snapshot.pattern),
    identity,
    palette,
    tagIds,
  };
}

export async function createCommunityWork(db: AnyDatabase, input: CreateRevisionInput) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const payload = await revisionPayload(tx, { ...input, now });
    const [work] = await tx.insert(communityWorks).values({
      authorUserId: input.actor.userId,
      authorType: 'user',
      createdAt: now,
      updatedAt: now,
    }).returning();
    const [revision] = await tx.insert(communityRevisions).values({
      workId: work.id,
      revisionNumber: 1,
      title: payload.title,
      authorType: 'user',
      publicAuthorId: payload.identity.publicAuthorId,
      frozenDisplayName: payload.identity.displayName,
      sourceDesignId: input.designId,
      licenseVersion: COMMUNITY_LICENSE_VERSION,
      licenseConfirmedAt: now,
      engineVersion: payload.snapshot.engineVersion,
      boardProfile: payload.snapshot.boardProfile,
      paletteKind: payload.palette.kind,
      paletteId: payload.palette.id,
      width: payload.snapshot.pattern.width,
      height: payload.snapshot.pattern.height,
      colorCount: snapshotColorCount(payload.snapshot),
      snapshot: payload.snapshot,
      preview: payload.preview,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (payload.tagIds.length > 0) {
      await tx.insert(communityRevisionTags).values(payload.tagIds.map((tagId) => ({ revisionId: revision.id, tagId })));
    }
    return { work, revision };
  });
}

export async function createCommunityRevision(
  db: AnyDatabase,
  input: CreateRevisionInput & { workId: string },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [work] = await tx.select().from(communityWorks).where(eq(communityWorks.id, input.workId)).for('update');
    if (!work || work.authorUserId !== input.actor.userId) throw new AppError('NOT_FOUND', '作品不存在');
    if (work.lifecycleStatus !== 'active') throw new AppError('STATE_CONFLICT', '作品当前不能提交新修订');
    const [open] = await tx.select({ value: count() }).from(communityRevisions).where(and(
      eq(communityRevisions.workId, work.id),
      inArray(communityRevisions.status, ['draft', 'pending_review']),
    ));
    if (open.value > 0) throw new AppError('STATE_CONFLICT', '请先处理现有草稿或待审修订');
    const payload = await revisionPayload(tx, { ...input, now });
    const [number] = await tx.select({ value: max(communityRevisions.revisionNumber) })
      .from(communityRevisions).where(eq(communityRevisions.workId, work.id));
    const [revision] = await tx.insert(communityRevisions).values({
      workId: work.id,
      revisionNumber: Number(number.value ?? 0) + 1,
      title: payload.title,
      authorType: 'user',
      publicAuthorId: payload.identity.publicAuthorId,
      frozenDisplayName: payload.identity.displayName,
      sourceDesignId: input.designId,
      licenseVersion: COMMUNITY_LICENSE_VERSION,
      licenseConfirmedAt: now,
      engineVersion: payload.snapshot.engineVersion,
      boardProfile: payload.snapshot.boardProfile,
      paletteKind: payload.palette.kind,
      paletteId: payload.palette.id,
      width: payload.snapshot.pattern.width,
      height: payload.snapshot.pattern.height,
      colorCount: snapshotColorCount(payload.snapshot),
      snapshot: payload.snapshot,
      preview: payload.preview,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (payload.tagIds.length > 0) {
      await tx.insert(communityRevisionTags).values(payload.tagIds.map((tagId) => ({ revisionId: revision.id, tagId })));
    }
    return revision;
  });
}

export async function submitCommunityRevision(
  db: AnyDatabase,
  input: { actor: Actor; revisionId: string; expectedVersion: number; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [revision] = await tx.select({
      id: communityRevisions.id,
      workId: communityRevisions.workId,
      status: communityRevisions.status,
      version: communityRevisions.version,
      authorUserId: communityWorks.authorUserId,
      lifecycleStatus: communityWorks.lifecycleStatus,
    }).from(communityRevisions).innerJoin(communityWorks, eq(communityWorks.id, communityRevisions.workId))
      .where(eq(communityRevisions.id, input.revisionId)).for('update');
    if (!revision || revision.authorUserId !== input.actor.userId) throw new AppError('NOT_FOUND', '修订不存在');
    if (revision.version !== input.expectedVersion || revision.status !== 'draft' || revision.lifecycleStatus !== 'active') {
      throw new AppError('STATE_CONFLICT', '修订状态已变化，请刷新后重试');
    }
    const [updated] = await tx.update(communityRevisions).set({
      status: 'pending_review', version: revision.version + 1, submittedAt: now, updatedAt: now,
    }).where(and(eq(communityRevisions.id, revision.id), eq(communityRevisions.version, revision.version))).returning();
    if (!updated) throw new AppError('STATE_CONFLICT', '修订状态已变化，请刷新后重试');
    return updated;
  });
}

export async function withdrawCommunitySubmission(
  db: AnyDatabase,
  input: { actor: Actor; revisionId: string; expectedVersion: number; now?: Date },
) {
  const now = input.now ?? new Date();
  const [revision] = await db.select({
    id: communityRevisions.id,
    version: communityRevisions.version,
    status: communityRevisions.status,
    authorUserId: communityWorks.authorUserId,
  }).from(communityRevisions).innerJoin(communityWorks, eq(communityWorks.id, communityRevisions.workId))
    .where(eq(communityRevisions.id, input.revisionId));
  if (!revision || revision.authorUserId !== input.actor.userId) throw new AppError('NOT_FOUND', '修订不存在');
  if (revision.version !== input.expectedVersion || !['draft', 'pending_review'].includes(revision.status)) {
    throw new AppError('STATE_CONFLICT', '修订状态已变化，请刷新后重试');
  }
  const [updated] = await db.update(communityRevisions).set({
    status: 'withdrawn', version: revision.version + 1, withdrawnAt: now, updatedAt: now,
  }).where(and(eq(communityRevisions.id, revision.id), eq(communityRevisions.version, revision.version))).returning();
  if (!updated) throw new AppError('STATE_CONFLICT', '修订状态已变化，请刷新后重试');
  return updated;
}

export async function withdrawCommunityWork(
  db: AnyDatabase,
  input: { actor: Actor; workId: string; expectedVersion: number; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [work] = await tx.select().from(communityWorks).where(eq(communityWorks.id, input.workId)).for('update');
    if (!work || work.authorUserId !== input.actor.userId) throw new AppError('NOT_FOUND', '作品不存在');
    if (work.version !== input.expectedVersion || work.lifecycleStatus !== 'active') {
      throw new AppError('STATE_CONFLICT', '作品状态已变化，请刷新后重试');
    }
    await tx.update(communityRevisions).set({ status: 'withdrawn', withdrawnAt: now, updatedAt: now })
      .where(and(eq(communityRevisions.workId, work.id), inArray(communityRevisions.status, ['draft', 'pending_review'])));
    const [updated] = await tx.update(communityWorks).set({
      lifecycleStatus: 'withdrawn', version: work.version + 1, withdrawnAt: now, updatedAt: now,
    }).where(and(eq(communityWorks.id, work.id), eq(communityWorks.version, work.version))).returning();
    if (!updated) throw new AppError('STATE_CONFLICT', '作品状态已变化，请刷新后重试');
    return updated;
  });
}

export async function reviewCommunityRevision(
  db: AnyDatabase,
  input: {
    actor: Actor;
    revisionId: string;
    decision: 'published' | 'rejected';
    expectedVersion: number;
    reason: string;
    requestId: string;
    now?: Date;
  },
) {
  const reason = reasonSchema.safeParse(input.reason);
  if (!reason.success) throw new AppError('VALIDATION', '审核理由需为 3–500 个字符', 'reason');
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [revision] = await tx.select().from(communityRevisions)
      .where(eq(communityRevisions.id, input.revisionId)).for('update');
    if (!revision) throw new AppError('NOT_FOUND', '修订不存在');
    const [work] = await tx.select().from(communityWorks).where(eq(communityWorks.id, revision.workId)).for('update');
    if (!work || work.lifecycleStatus !== 'active') throw new AppError('STATE_CONFLICT', '作品当前不能审核发布');
    if (revision.version !== input.expectedVersion || revision.status !== 'pending_review') {
      throw new AppError('STATE_CONFLICT', '修订状态已变化，请刷新后重试');
    }
    if (input.decision === 'published' && work.currentPublishedRevisionId) {
      await tx.update(communityRevisions).set({
        status: 'superseded',
        version: sql`${communityRevisions.version} + 1`,
        updatedAt: now,
      })
        .where(and(
          eq(communityRevisions.id, work.currentPublishedRevisionId),
          eq(communityRevisions.status, 'published'),
          ne(communityRevisions.id, revision.id),
        ));
    }
    const [updated] = await tx.update(communityRevisions).set({
      status: input.decision,
      version: revision.version + 1,
      reviewedAt: now,
      reviewedByUserId: input.actor.userId,
      reviewReason: reason.data,
      publishedAt: input.decision === 'published' ? now : null,
      updatedAt: now,
    }).where(and(eq(communityRevisions.id, revision.id), eq(communityRevisions.version, revision.version))).returning();
    if (!updated) throw new AppError('STATE_CONFLICT', '修订状态已变化，请刷新后重试');
    if (input.decision === 'published') {
      await tx.update(communityWorks).set({
        currentPublishedRevisionId: revision.id,
        version: work.version + 1,
        updatedAt: now,
      }).where(eq(communityWorks.id, work.id));
    }
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actor.userId,
      actorRole: input.actor.role,
      action: input.decision === 'published' ? 'community.revision_published' : 'community.revision_rejected',
      targetType: 'community_revision',
      targetId: revision.id,
      reason: reason.data,
      requestId: input.requestId,
      beforeState: sanitizeAuditState({ revisionStatus: revision.status, revision: revision.version }),
      afterState: sanitizeAuditState({ revisionStatus: updated.status, revision: updated.version }),
    });
    return updated;
  });
}
