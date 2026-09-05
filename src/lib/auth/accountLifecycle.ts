import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import {
  adminAuditLogs,
  analyticsEvents,
  analyticsIdentityLinks,
  communityComments,
  communityLikes,
  communityReports,
  communityRevisions,
  communityReuses,
  communityWorks,
  designShares,
  designs,
  emailTokens,
  idempotencyRecords,
  palettes,
  officialBatches,
  moderationRuleSetVersions,
  rateLimits,
  sessions,
  users,
} from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { sanitizeAuditState } from '@/lib/admin/audit';
import { lockAccountGovernance } from './writeAccess';

export async function anonymizeAccount(
  db: AnyDatabase,
  input: { userId: string; requestId: string; now?: Date },
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockAccountGovernance(tx);
    const [account] = await tx.select({
      id: users.id,
      role: users.role,
      accountStatus: users.accountStatus,
      governanceVersion: users.governanceVersion,
      publicAuthorId: users.publicAuthorId,
    }).from(users).where(eq(users.id, input.userId)).for('no key update');
    if (!account || account.accountStatus !== 'active') {
      throw new AppError('NOT_FOUND', '账号不存在');
    }
    const now = input.now ?? new Date();
    if (account.role === 'admin') {
      const [row] = await tx.select({ value: count() }).from(users).where(and(
        eq(users.role, 'admin'),
        eq(users.accountStatus, 'active'),
      ));
      if (row.value <= 1) {
        throw new AppError('STATE_CONFLICT', '必须先移交管理员角色才能注销账号');
      }
    }

    // All community mutations lock works before their comments/revisions.
    await tx.execute(sql`select id from ${communityWorks} where id in (
      select work_id from ${communityLikes} where user_id = ${account.id}
      union select work_id from ${communityComments} where author_user_id = ${account.id}
      union select id from ${communityWorks} where author_user_id = ${account.id} and author_type = 'user'
    ) order by id for update`);
    const ownWorks = tx.select({ id: communityWorks.id }).from(communityWorks)
      .where(and(eq(communityWorks.authorUserId, account.id), eq(communityWorks.authorType, 'user')));
    await tx.update(communityRevisions).set({
      status: 'withdrawn', withdrawnAt: now, updatedAt: now, version: sql`${communityRevisions.version} + 1`,
    }).where(and(inArray(communityRevisions.workId, ownWorks), inArray(communityRevisions.status, ['draft', 'pending_review'])));
    await tx.update(communityWorks).set({
      lifecycleStatus: 'withdrawn', withdrawnAt: now, updatedAt: now, version: sql`${communityWorks.version} + 1`,
    }).where(and(
      eq(communityWorks.authorUserId, account.id), eq(communityWorks.authorType, 'user'),
      isNull(communityWorks.currentPublishedRevisionId), eq(communityWorks.lifecycleStatus, 'active'),
    ));
    await tx.delete(sessions).where(eq(sessions.userId, account.id));
    await tx.delete(rateLimits).where(eq(rateLimits.key, `sync:write:${account.id}`));
    await tx.delete(emailTokens).where(eq(emailTokens.userId, account.id));
    // Account erasure removes user-linked raw analytics while preserving the
    // already de-identified daily rollups.
    await tx.delete(analyticsEvents).where(eq(analyticsEvents.userId, account.id));
    await tx.delete(analyticsIdentityLinks).where(eq(analyticsIdentityLinks.userId, account.id));
    const likeCounts = await tx.select({ workId: communityLikes.workId, value: count() })
      .from(communityLikes).where(eq(communityLikes.userId, account.id)).groupBy(communityLikes.workId);
    const commentCounts = await tx.select({ workId: communityComments.workId, value: count() })
      .from(communityComments).where(and(
        eq(communityComments.authorUserId, account.id),
        eq(communityComments.status, 'published'),
      )).groupBy(communityComments.workId);
    await tx.delete(communityLikes).where(eq(communityLikes.userId, account.id));
    for (const row of likeCounts) {
      await tx.update(communityWorks).set({
        likeCount: sql`greatest(0, ${communityWorks.likeCount} - ${Number(row.value)})`,
      }).where(eq(communityWorks.id, row.workId));
    }
    await tx.update(communityComments).set({
      authorUserId: null,
      status: 'deleted',
      body: '',
      riskCategories: [],
      deletedAt: now,
      updatedAt: now,
      version: sql`${communityComments.version} + 1`,
    }).where(eq(communityComments.authorUserId, account.id));
    for (const row of commentCounts) {
      await tx.update(communityWorks).set({
        commentCount: sql`greatest(0, ${communityWorks.commentCount} - ${Number(row.value)})`,
      }).where(eq(communityWorks.id, row.workId));
    }
    await tx.update(communityReports).set({ reporterUserId: null }).where(eq(communityReports.reporterUserId, account.id));
    await tx.update(communityReports).set({ handledByUserId: null }).where(eq(communityReports.handledByUserId, account.id));
    await tx.update(communityComments).set({ reviewedByUserId: null }).where(eq(communityComments.reviewedByUserId, account.id));
    await tx.update(communityRevisions).set({ reviewedByUserId: null }).where(eq(communityRevisions.reviewedByUserId, account.id));
    await tx.update(communityWorks).set({ featuredByUserId: null }).where(eq(communityWorks.featuredByUserId, account.id));
    await tx.update(officialBatches).set({ adminUserId: null }).where(eq(officialBatches.adminUserId, account.id));
    await tx.update(moderationRuleSetVersions).set({ createdByUserId: null }).where(eq(moderationRuleSetVersions.createdByUserId, account.id));
    await tx.update(communityReuses).set({ userId: null }).where(eq(communityReuses.userId, account.id));
    await tx.delete(idempotencyRecords).where(or(
      eq(idempotencyRecords.actorUserId, account.id),
      eq(idempotencyRecords.scope, `admin.user:${account.id}`),
      // Other operators may have cached a response containing this user's ID.
      sql`jsonb_path_exists(${idempotencyRecords.response}, '$.** ? (@ == $userId)', jsonb_build_object('userId', ${account.id}::text))`,
      account.publicAuthorId
        ? sql`jsonb_path_exists(${idempotencyRecords.response}, '$.** ? (@ == $authorId)', jsonb_build_object('authorId', ${account.publicAuthorId}::text))`
        : undefined,
    ));
    await tx.delete(designShares).where(eq(designShares.userId, account.id));
    await tx.delete(designs).where(eq(designs.userId, account.id));
    await tx.delete(palettes).where(eq(palettes.userId, account.id));

    // Audit facts remain append-only, but the retired account must no longer be
    // recoverable from actor/target identifiers or account-state snapshots.
    await tx.update(adminAuditLogs).set({ actorUserId: null })
      .where(eq(adminAuditLogs.actorUserId, account.id));
    await tx.update(adminAuditLogs).set({
      targetId: 'anonymized',
      beforeState: null,
      afterState: null,
    }).where(and(
      eq(adminAuditLogs.targetType, 'user'),
      eq(adminAuditLogs.targetId, account.id),
    ));

    const [updated] = await tx.update(users).set({
      email: null,
      username: null,
      passwordHash: null,
      emailVerifiedAt: null,
      role: 'user',
      accountStatus: 'anonymized',
      governanceVersion: account.governanceVersion + 1,
      accountStatusReason: 'self_requested',
      statusChangedAt: now,
      suspendedAt: null,
      anonymizedAt: now,
      updatedAt: now,
    }).where(eq(users.id, account.id)).returning();

    await tx.insert(adminAuditLogs).values({
      actorUserId: null,
      actorRole: account.role,
      action: 'account.anonymized',
      targetType: 'user',
      targetId: 'anonymized',
      reason: '用户确认注销账号',
      requestId: input.requestId,
      beforeState: sanitizeAuditState({ role: account.role, accountStatus: account.accountStatus }),
      afterState: sanitizeAuditState({ role: updated.role, accountStatus: updated.accountStatus }),
    });
  });
}
