import { and, eq } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { communityComments, communityReports, communityRevisions, communityWorks } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { parseCommunitySnapshot, type CommunitySnapshotV1 } from './snapshot';

export interface ReportTargetInspection {
  reportId: string;
  targetType: 'work' | 'comment';
  targetId: string;
  reportedVersion: number;
  contentVersion: number | null;
  currentVersion: number | null;
  title: string | null;
  workId: string | null;
  workStatus: 'active' | 'withdrawn' | 'removed' | null;
  contentStatus: string | null;
  changed: boolean;
  snapshot: CommunitySnapshotV1 | null;
  body: string | null;
  publicUrl: string | null;
}

/** 仅供治理 DAL 调用。一次读取所选案件的必要内容，不把账号、令牌或私人设计带入 DTO。 */
export async function inspectCommunityReport(db: AnyDatabase, reportId: string): Promise<ReportTargetInspection> {
  const [report] = await db.select({
    id: communityReports.id, targetType: communityReports.targetType,
    targetId: communityReports.targetId, targetVersion: communityReports.targetVersion,
  }).from(communityReports).where(eq(communityReports.id, reportId));
  if (!report) throw new AppError('NOT_FOUND', '举报不存在');
  const result: ReportTargetInspection = {
    reportId, targetType: report.targetType, targetId: report.targetId, reportedVersion: report.targetVersion,
    contentVersion: null, currentVersion: null, title: null, workId: null, workStatus: null,
    contentStatus: null, changed: false, snapshot: null, body: null, publicUrl: null,
  };
  const [comment] = report.targetType === 'comment' ? await db.select({
    workId: communityComments.workId, body: communityComments.body,
    status: communityComments.status, version: communityComments.version,
  }).from(communityComments).where(eq(communityComments.id, report.targetId)) : [];
  const workId = report.targetType === 'work' ? report.targetId : comment?.workId;
  if (!workId) return result;
  const [work] = await db.select({
    lifecycleStatus: communityWorks.lifecycleStatus, currentPublishedRevisionId: communityWorks.currentPublishedRevisionId,
  }).from(communityWorks).where(eq(communityWorks.id, workId));
  const [current] = work?.currentPublishedRevisionId ? await db.select({
    revisionNumber: communityRevisions.revisionNumber, title: communityRevisions.title, status: communityRevisions.status,
  }).from(communityRevisions).where(eq(communityRevisions.id, work.currentPublishedRevisionId)) : [];
  result.workId = workId;
  result.workStatus = work?.lifecycleStatus ?? null;
  result.title = current?.title ?? null;
  const publicWork = work?.lifecycleStatus === 'active' && current?.status === 'published';
  if (report.targetType === 'work') {
    const [revision] = await db.select({
      title: communityRevisions.title, revisionNumber: communityRevisions.revisionNumber,
      status: communityRevisions.status, snapshot: communityRevisions.snapshot,
    }).from(communityRevisions).where(and(eq(communityRevisions.workId, workId), eq(communityRevisions.revisionNumber, report.targetVersion)));
    result.title = revision?.title ?? result.title;
    result.contentVersion = revision?.revisionNumber ?? null;
    result.contentStatus = revision?.status ?? null;
    result.currentVersion = current?.revisionNumber ?? null;
    result.snapshot = parseCommunitySnapshot(revision?.snapshot);
    result.publicUrl = publicWork ? `/community/${workId}` : null;
  } else if (comment) {
    result.contentVersion = comment.version;
    result.currentVersion = comment.version;
    result.contentStatus = comment.status;
    result.body = comment.status === 'deleted' ? null : comment.body;
    result.publicUrl = publicWork && comment.status === 'published' ? `/community/${workId}#comment-${report.targetId}` : null;
  }
  result.changed = result.currentVersion !== null && result.currentVersion !== report.targetVersion;
  return result;
}
