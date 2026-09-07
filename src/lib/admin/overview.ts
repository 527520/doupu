import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { communityComments, communityReports, communityRevisions } from '@/../db/schema';
import { summarizeModerationToday } from '@/lib/moderation/commentModeration';

export interface AdminOverview {
  /** 等待人工审核的投稿修订。 */
  pendingRevisions: number;
  /** 待审 + 最近 30 天被拦截的评论（与评论治理台队列同口径）。 */
  pendingComments: number;
  /** 尚未结案的举报（待处理与已受理）。 */
  openReports: number;
  /** 内容安全服务是否处于降级（未配置 / 连续失败 / 预算耗尽）；仅管理员可见。 */
  moderationDegraded: boolean | null;
}

async function count(db: AnyDatabase, query: Promise<Array<{ value: number }>>): Promise<number> {
  const [row] = await query;
  return Number(row?.value ?? 0);
}

/** 后台总览与导航角标共用的待办计数；`includeSystem` 为 false 时不查系统健康（审核员看不到）。 */
export async function getAdminOverview(db: AnyDatabase, options: { includeSystem: boolean; now?: Date }): Promise<AdminOverview> {
  const now = options.now ?? new Date();
  const rejectedSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [pendingRevisions, pendingComments, openReports, moderation] = await Promise.all([
    count(db, db.select({ value: sql<number>`count(*)::int` }).from(communityRevisions).where(eq(communityRevisions.status, 'pending_review'))),
    count(db, db.select({ value: sql<number>`count(*)::int` }).from(communityComments)
      .where(or(eq(communityComments.status, 'pending_review'), and(eq(communityComments.status, 'rejected'), gte(communityComments.createdAt, rejectedSince))))),
    count(db, db.select({ value: sql<number>`count(*)::int` }).from(communityReports).where(inArray(communityReports.status, ['open', 'accepted']))),
    options.includeSystem ? summarizeModerationToday(db, now) : null,
  ]);
  return {
    pendingRevisions, pendingComments, openReports,
    moderationDegraded: moderation ? !moderation.enabled || moderation.health.consecutiveFailures > 0 || moderation.calls >= moderation.budget : null,
  };
}
