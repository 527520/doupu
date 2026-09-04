import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDatabase } from '@/../db/client';
import {
  adminAuditLogs,
  communityComments,
  communityLikes,
  communityReports,
  communityReuses,
  communityRevisions,
  communityWorks,
  designs,
  moderationRuleSetVersions,
  users,
} from '@/../db/schema';
import type { Actor } from '@/lib/auth/authorization';
import { resolvePublicDisplayName, ANONYMIZED_DISPLAY_NAME } from '@/lib/identity/publicAuthor';
import { sanitizeAuditState } from '@/lib/admin/audit';
import { AppError } from '@/lib/errors';
import type { ProjectFile } from '@/lib/types';
import { moderateText, moderationRulesSchema, type ModerationRule } from './moderation';
import { parseCommunitySnapshot } from './snapshot';

const commentBodySchema = z.string().trim().min(1).max(500);
const reasonSchema = z.string().trim().min(3).max(500);
export const reportCategorySchema = z.enum(['harm', 'harassment', 'sexual', 'spam', 'copyright', 'other']);

async function activeWork(tx: AnyDatabase, workId: string, lock = false) {
  const query = tx.select().from(communityWorks).where(eq(communityWorks.id, workId));
  const [work] = lock ? await query.for('update') : await query;
  if (!work || work.lifecycleStatus !== 'active' || !work.currentPublishedRevisionId) {
    throw new AppError('NOT_FOUND', '作品不存在');
  }
  return work;
}

async function commentIdentity(tx: AnyDatabase, actor: Actor) {
  const [user] = await tx.select({
    email: users.email,
    username: users.username,
    publicAuthorId: users.publicAuthorId,
    accountStatus: users.accountStatus,
  }).from(users).where(eq(users.id, actor.userId)).for('update');
  if (!user || user.accountStatus !== 'active' || !user.email) throw new AppError('FORBIDDEN', '账号当前不可用');
  const publicAuthorId = user.publicAuthorId ?? randomUUID();
  if (!user.publicAuthorId) {
    await tx.update(users).set({ publicAuthorId, updatedAt: new Date() }).where(eq(users.id, actor.userId));
  }
  return { publicAuthorId, displayName: resolvePublicDisplayName(user.username, user.email) };
}

async function activeRules(tx: AnyDatabase): Promise<ModerationRule[]> {
  const [row] = await tx.select({ rules: moderationRuleSetVersions.rules })
    .from(moderationRuleSetVersions).where(eq(moderationRuleSetVersions.active, true));
  const parsed = moderationRulesSchema.safeParse(row?.rules ?? []);
  return parsed.success ? parsed.data : [];
}

export async function setCommunityLike(db: AnyDatabase, input: { actor: Actor; workId: string; liked: boolean }) {
  return db.transaction(async (tx) => {
    const work = await activeWork(tx, input.workId, true);
    if (input.liked) {
      const inserted = await tx.insert(communityLikes).values({ workId: work.id, userId: input.actor.userId })
        .onConflictDoNothing().returning();
      if (inserted.length > 0) {
        const [updated] = await tx.update(communityWorks).set({
          likeCount: sql`${communityWorks.likeCount} + 1`, updatedAt: new Date(),
        }).where(eq(communityWorks.id, work.id)).returning();
        return { liked: true, likeCount: updated.likeCount };
      }
    } else {
      const removed = await tx.delete(communityLikes).where(and(
        eq(communityLikes.workId, work.id), eq(communityLikes.userId, input.actor.userId),
      )).returning();
      if (removed.length > 0) {
        const [updated] = await tx.update(communityWorks).set({
          likeCount: sql`greatest(0, ${communityWorks.likeCount} - 1)`, updatedAt: new Date(),
        }).where(eq(communityWorks.id, work.id)).returning();
        return { liked: false, likeCount: updated.likeCount };
      }
    }
    return { liked: input.liked, likeCount: work.likeCount };
  });
}

export async function reuseCommunityWork(db: AnyDatabase, input: { actor: Actor; workId: string; now?: Date }) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const work = await activeWork(tx, input.workId, true);
    const [revision] = await tx.select().from(communityRevisions)
      .where(eq(communityRevisions.id, work.currentPublishedRevisionId!));
    const snapshot = parseCommunitySnapshot(revision?.snapshot);
    if (!revision || revision.status !== 'published' || !snapshot) throw new AppError('STATE_CONFLICT', '公开修订已变化');
    const designId = randomUUID();
    const project: ProjectFile = {
      format: 'doupu-project', version: 3,
      engineVersion: snapshot.engineVersion,
      boardProfile: snapshot.boardProfile,
      name: `${revision.title}（引用）`,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
      paletteSelection: snapshot.paletteSelection,
      params: snapshot.params,
      pattern: snapshot.pattern,
    };
    const encoded = JSON.stringify(project);
    await tx.insert(designs).values({
      id: designId, userId: input.actor.userId, name: project.name, project,
      payloadBytes: Buffer.byteLength(encoded), revision: 1,
      communitySourceWorkId: work.id, communitySourceRevisionId: revision.id,
      updatedAt: now,
    });
    await tx.insert(communityReuses).values({
      workId: work.id, revisionId: revision.id, userId: input.actor.userId, designId, createdAt: now,
    });
    const [updated] = await tx.update(communityWorks).set({
      reuseCount: sql`${communityWorks.reuseCount} + 1`, updatedAt: now,
    }).where(eq(communityWorks.id, work.id)).returning();
    return { designId, workId: work.id, revisionId: revision.id, reuseCount: updated.reuseCount };
  });
}

export async function createCommunityComment(db: AnyDatabase, input: {
  actor: Actor; workId: string; body: string; now?: Date;
}) {
  const body = commentBodySchema.safeParse(input.body);
  if (!body.success) throw new AppError('VALIDATION', '评论需为 1–500 个字符', 'body');
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const work = await activeWork(tx, input.workId, true);
    if (work.commentsLocked) throw new AppError('COMMENTS_LOCKED', '作品评论已锁定');
    const [rules, identity, recent] = await Promise.all([
      activeRules(tx),
      commentIdentity(tx, input.actor),
      tx.select({ body: communityComments.body }).from(communityComments).where(and(
        eq(communityComments.authorUserId, input.actor.userId),
        inArray(communityComments.status, ['published', 'pending_review']),
        gte(communityComments.createdAt, new Date(now.getTime() - 5 * 60 * 1000)),
      )).orderBy(desc(communityComments.createdAt)).limit(6),
    ]);
    const moderation = moderateText(body.data, rules);
    if (recent.length >= 5 || recent.some((row) => row.body.normalize('NFKC') === body.data.normalize('NFKC'))) {
      moderation.needsReview = true;
      if (!moderation.categories.includes('spam')) moderation.categories.push('spam');
    }
    const status = moderation.needsReview ? 'pending_review' : 'published';
    const [comment] = await tx.insert(communityComments).values({
      workId: work.id, authorUserId: input.actor.userId,
      publicAuthorId: identity.publicAuthorId, frozenDisplayName: identity.displayName,
      status, body: body.data, riskCategories: moderation.categories,
      createdAt: now, updatedAt: now,
    }).returning();
    if (status === 'published') {
      await tx.update(communityWorks).set({ commentCount: sql`${communityWorks.commentCount} + 1`, updatedAt: now })
        .where(eq(communityWorks.id, work.id));
    }
    return comment;
  });
}

export async function editCommunityComment(db: AnyDatabase, input: {
  actor: Actor; commentId: string; expectedVersion: number; body: string; now?: Date;
}) {
  const body = commentBodySchema.safeParse(input.body);
  if (!body.success) throw new AppError('VALIDATION', '评论需为 1–500 个字符', 'body');
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [comment] = await tx.select().from(communityComments).where(eq(communityComments.id, input.commentId)).for('update');
    if (!comment || comment.authorUserId !== input.actor.userId || comment.status === 'deleted') throw new AppError('NOT_FOUND', '评论不存在');
    if (comment.version !== input.expectedVersion) throw new AppError('STATE_CONFLICT', '评论版本已变化');
    if (now.getTime() - comment.createdAt.getTime() > 15 * 60 * 1000) throw new AppError('FORBIDDEN', '评论只能在发布后 15 分钟内编辑');
    const work = await activeWork(tx, comment.workId, true);
    if (work.commentsLocked) throw new AppError('COMMENTS_LOCKED', '作品评论已锁定');
    const moderation = moderateText(body.data, await activeRules(tx));
    const status = moderation.needsReview ? 'pending_review' : 'published';
    const [updated] = await tx.update(communityComments).set({
      body: body.data, status, riskCategories: moderation.categories,
      version: comment.version + 1, editedAt: now, updatedAt: now,
      reviewedAt: null, reviewedByUserId: null, reviewReason: null,
    }).where(and(eq(communityComments.id, comment.id), eq(communityComments.version, comment.version))).returning();
    if (!updated) throw new AppError('STATE_CONFLICT', '评论版本已变化');
    const delta = Number(status === 'published') - Number(comment.status === 'published');
    if (delta !== 0) await tx.update(communityWorks).set({
      commentCount: sql`greatest(0, ${communityWorks.commentCount} + ${delta})`, updatedAt: now,
    }).where(eq(communityWorks.id, work.id));
    return updated;
  });
}

export async function deleteCommunityComment(db: AnyDatabase, input: {
  actor: Actor; commentId: string; expectedVersion: number; now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [comment] = await tx.select().from(communityComments).where(eq(communityComments.id, input.commentId)).for('update');
    if (!comment || comment.authorUserId !== input.actor.userId || comment.status === 'deleted') throw new AppError('NOT_FOUND', '评论不存在');
    if (comment.version !== input.expectedVersion) throw new AppError('STATE_CONFLICT', '评论版本已变化');
    const [updated] = await tx.update(communityComments).set({
      status: 'deleted', body: '', riskCategories: [], deletedAt: now,
      version: comment.version + 1, updatedAt: now,
    }).where(and(eq(communityComments.id, comment.id), eq(communityComments.version, comment.version))).returning();
    if (comment.status === 'published') await tx.update(communityWorks).set({
      commentCount: sql`greatest(0, ${communityWorks.commentCount} - 1)`, updatedAt: now,
    }).where(eq(communityWorks.id, comment.workId));
    return updated;
  });
}

export async function listCommunityComments(db: AnyDatabase, workId: string, viewerUserId?: string) {
  await activeWork(db, workId);
  const rows = await db.select({
    id: communityComments.id, publicAuthorId: communityComments.publicAuthorId,
    authorUserId: communityComments.authorUserId,
    frozenDisplayName: communityComments.frozenDisplayName, accountStatus: users.accountStatus,
    body: communityComments.body, version: communityComments.version,
    createdAt: communityComments.createdAt, editedAt: communityComments.editedAt,
  }).from(communityComments).leftJoin(users, eq(users.id, communityComments.authorUserId))
    .where(and(eq(communityComments.workId, workId), eq(communityComments.status, 'published')))
    .orderBy(communityComments.createdAt).limit(100);
  return rows.map((row) => ({
    id: row.id,
    author: { publicAuthorId: row.publicAuthorId, displayName: row.accountStatus === 'anonymized' ? ANONYMIZED_DISPLAY_NAME : row.frozenDisplayName },
    body: row.body, version: row.version,
    createdAt: row.createdAt.toISOString(), editedAt: row.editedAt?.toISOString() ?? null,
    editable: row.authorUserId === viewerUserId && Date.now() - row.createdAt.getTime() <= 15 * 60 * 1000,
  }));
}

export async function reportCommunityTarget(db: AnyDatabase, input: {
  actor: Actor; targetType: 'work' | 'comment'; targetId: string; category: z.infer<typeof reportCategorySchema>; details?: string;
}) {
  const details = input.details?.trim();
  if (details && details.length > 500) throw new AppError('VALIDATION', '举报补充说明最多 500 字', 'details');
  return db.transaction(async (tx) => {
    let targetVersion: number;
    if (input.targetType === 'work') {
      const work = await activeWork(tx, input.targetId);
      const [revision] = await tx.select({ version: communityRevisions.version }).from(communityRevisions)
        .where(eq(communityRevisions.id, work.currentPublishedRevisionId!));
      if (!revision) throw new AppError('NOT_FOUND', '作品不存在');
      targetVersion = revision.version;
    } else {
      const [comment] = await tx.select({ version: communityComments.version, status: communityComments.status })
        .from(communityComments).where(eq(communityComments.id, input.targetId));
      if (!comment || comment.status !== 'published') throw new AppError('NOT_FOUND', '评论不存在');
      targetVersion = comment.version;
    }
    const created = await tx.insert(communityReports).values({
      targetType: input.targetType, targetId: input.targetId, targetVersion,
      reporterUserId: input.actor.userId, category: input.category, details: details || null,
    }).onConflictDoNothing().returning();
    if (created.length === 0) throw new AppError('CONFLICT', '你已经举报过当前版本');
    return created[0];
  });
}

export async function moderateCommunityComment(db: AnyDatabase, input: {
  actor: Actor; commentId: string; decision: 'published' | 'hidden'; expectedVersion: number;
  reason: string; requestId: string; now?: Date;
}) {
  const reason = reasonSchema.parse(input.reason);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [comment] = await tx.select().from(communityComments).where(eq(communityComments.id, input.commentId)).for('update');
    if (!comment || comment.status === 'deleted') throw new AppError('NOT_FOUND', '评论不存在');
    if (comment.version !== input.expectedVersion || !['pending_review', 'published'].includes(comment.status)) {
      throw new AppError('STATE_CONFLICT', '评论状态已变化');
    }
    const [updated] = await tx.update(communityComments).set({
      status: input.decision, version: comment.version + 1,
      reviewedByUserId: input.actor.userId, reviewReason: reason, reviewedAt: now, updatedAt: now,
    }).where(and(eq(communityComments.id, comment.id), eq(communityComments.version, comment.version))).returning();
    const delta = Number(input.decision === 'published') - Number(comment.status === 'published');
    if (delta !== 0) await tx.update(communityWorks).set({
      commentCount: sql`greatest(0, ${communityWorks.commentCount} + ${delta})`, updatedAt: now,
    }).where(eq(communityWorks.id, comment.workId));
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actor.userId, actorRole: input.actor.role,
      action: `community.comment_${input.decision}`, targetType: 'community_comment', targetId: comment.id,
      reason, requestId: input.requestId,
      beforeState: sanitizeAuditState({ status: comment.status, revision: comment.version }),
      afterState: sanitizeAuditState({ status: updated.status, revision: updated.version }),
    });
    return updated;
  });
}

export async function handleCommunityReport(db: AnyDatabase, input: {
  actor: Actor; reportId: string; decision: 'accepted' | 'resolved' | 'dismissed'; expectedVersion: number;
  reason: string; requestId: string; now?: Date;
}) {
  const reason = reasonSchema.parse(input.reason);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [report] = await tx.select().from(communityReports).where(eq(communityReports.id, input.reportId)).for('update');
    if (!report) throw new AppError('NOT_FOUND', '举报不存在');
    const allowed = input.decision === 'accepted'
      ? report.status === 'open'
      : input.decision === 'resolved'
        ? report.status === 'accepted'
        : ['open', 'accepted'].includes(report.status);
    if (!allowed || report.version !== input.expectedVersion) throw new AppError('STATE_CONFLICT', '举报状态已变化');
    const [updated] = await tx.update(communityReports).set({
      status: input.decision, version: report.version + 1,
      handledByUserId: input.actor.userId, handlingReason: reason, handledAt: now, updatedAt: now,
    }).where(and(eq(communityReports.id, report.id), eq(communityReports.version, report.version))).returning();
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actor.userId, actorRole: input.actor.role,
      action: `community.report_${input.decision}`, targetType: 'community_report', targetId: report.id,
      reason, requestId: input.requestId,
      beforeState: sanitizeAuditState({ status: report.status, revision: report.version }),
      afterState: sanitizeAuditState({ status: updated.status, revision: updated.version }),
    });
    return updated;
  });
}

export async function listGovernanceQueues(db: AnyDatabase) {
  const [comments, reports] = await Promise.all([
    db.select({ id: communityComments.id, workId: communityComments.workId, status: communityComments.status,
      version: communityComments.version, body: communityComments.body, riskCategories: communityComments.riskCategories,
      createdAt: communityComments.createdAt }).from(communityComments)
      .where(eq(communityComments.status, 'pending_review')).orderBy(communityComments.createdAt).limit(100),
    db.select().from(communityReports).where(inArray(communityReports.status, ['open', 'accepted']))
      .orderBy(communityReports.createdAt).limit(100),
  ]);
  return { comments, reports };
}

export async function createModerationRuleSet(db: AnyDatabase, input: {
  actor: Actor; rules: unknown; reason: string; requestId: string;
}) {
  const rules = moderationRulesSchema.parse(input.rules);
  const reason = reasonSchema.parse(input.reason);
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ value: count(), max: sql<number>`coalesce(max(${moderationRuleSetVersions.version}), 0)` })
      .from(moderationRuleSetVersions);
    await tx.update(moderationRuleSetVersions).set({ active: false }).where(eq(moderationRuleSetVersions.active, true));
    const [created] = await tx.insert(moderationRuleSetVersions).values({
      version: Number(current.max) + 1, rules, active: true,
      createdByUserId: input.actor.userId, reason,
    }).returning();
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actor.userId, actorRole: input.actor.role,
      action: 'moderation.rule_set_activated', targetType: 'moderation_rule_set', targetId: created.id,
      reason, requestId: input.requestId,
      beforeState: sanitizeAuditState({ count: current.value }),
      afterState: sanitizeAuditState({ revision: created.version, ruleCount: rules.length }),
    });
    return created;
  });
}
