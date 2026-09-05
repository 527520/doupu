import { and, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDatabase } from '@/../db/client';
import { communityRevisions, communityWorks, users } from '@/../db/schema';
import { ANONYMIZED_DISPLAY_NAME } from '@/lib/identity/publicAuthor';
import { AppError } from '@/lib/errors';
import { communityPreviewSchema, parseCommunitySnapshot } from './snapshot';

const querySchema = z.object({
  q: z.string().trim().max(80).default(''),
  status: z.enum(['all', 'active', 'withdrawn', 'removed']).default('all'),
  cursor: z.string().max(500).optional(),
}).strict();
const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() }).strict();
const PAGE_SIZE = 50;

export async function listManagedCommunityWorks(db: AnyDatabase, input: unknown) {
  const query = querySchema.parse(input);
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (query.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))); }
    catch { throw new AppError('VALIDATION', '作品列表游标无效'); }
  }
  // Lists only read the small preview. A selected work fetches its frozen material separately.
  const displayRevision = sql`coalesce(${communityWorks.currentPublishedRevisionId},
    (select r.id from community_revisions r where r.work_id = ${communityWorks.id} order by r.revision_number desc limit 1))`;
  const rows = await db.select({
    id: communityWorks.id, version: communityWorks.version, lifecycleStatus: communityWorks.lifecycleStatus,
    commentsLocked: communityWorks.commentsLocked, featuredAt: communityWorks.featuredAt,
    currentPublishedRevisionId: communityWorks.currentPublishedRevisionId,
    createdAt: communityWorks.createdAt, title: communityRevisions.title, preview: communityRevisions.preview,
    authorType: communityRevisions.authorType, displayName: communityRevisions.frozenDisplayName,
    accountStatus: users.accountStatus, revisionNumber: communityRevisions.revisionNumber,
  }).from(communityWorks).leftJoin(communityRevisions, eq(communityRevisions.id, displayRevision))
    .leftJoin(users, eq(users.id, communityWorks.authorUserId))
    .where(and(
      query.status === 'all' ? undefined : eq(communityWorks.lifecycleStatus, query.status),
      query.q ? or(ilike(communityRevisions.title, `%${query.q}%`), ilike(communityRevisions.frozenDisplayName, `%${query.q}%`), sql`${communityWorks.id}::text = ${query.q}`) : undefined,
      cursor ? or(lt(communityWorks.createdAt, new Date(cursor.createdAt)), and(eq(communityWorks.createdAt, new Date(cursor.createdAt)), lt(communityWorks.id, cursor.id))) : undefined,
    )).orderBy(desc(communityWorks.createdAt), desc(communityWorks.id)).limit(PAGE_SIZE + 1);
  const items = rows.slice(0, PAGE_SIZE).map((row) => {
    const preview = communityPreviewSchema.safeParse(row.preview);
    return {
      id: row.id, version: row.version, lifecycleStatus: row.lifecycleStatus, commentsLocked: row.commentsLocked,
      isPublic: row.lifecycleStatus === 'active' && row.currentPublishedRevisionId !== null,
      featured: row.featuredAt !== null, title: row.title, revisionNumber: row.revisionNumber,
      displayName: row.authorType === 'official' ? '豆谱官方' : row.accountStatus === 'anonymized' ? ANONYMIZED_DISPLAY_NAME : row.displayName,
      preview: preview.success ? preview.data : null,
    };
  });
  const last = rows[PAGE_SIZE - 1];
  return { items, nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null };
}

export async function inspectManagedCommunityWork(db: AnyDatabase, workId: string) {
  const [work] = await db.select({
    id: communityWorks.id, version: communityWorks.version, lifecycleStatus: communityWorks.lifecycleStatus,
    currentPublishedRevisionId: communityWorks.currentPublishedRevisionId, commentsLocked: communityWorks.commentsLocked,
    featuredAt: communityWorks.featuredAt, removedReason: communityWorks.removedReason,
    likeCount: communityWorks.likeCount, commentCount: communityWorks.commentCount, reuseCount: communityWorks.reuseCount,
  }).from(communityWorks).where(eq(communityWorks.id, workId));
  if (!work) throw new AppError('NOT_FOUND', '作品不存在');
  const [approved] = await db.select({ id: communityRevisions.id }).from(communityRevisions)
    .where(and(eq(communityRevisions.workId, workId), inArray(communityRevisions.status, ['published', 'superseded'])))
    .orderBy(desc(communityRevisions.revisionNumber)).limit(1);
  const [latest] = await db.select({
    id: communityRevisions.id, revisionNumber: communityRevisions.revisionNumber, status: communityRevisions.status,
  }).from(communityRevisions).where(eq(communityRevisions.workId, workId)).orderBy(desc(communityRevisions.revisionNumber)).limit(1);
  const materialId = work.currentPublishedRevisionId ?? approved?.id ?? latest?.id;
  const [revision] = materialId ? await db.select({
    id: communityRevisions.id, title: communityRevisions.title, revisionNumber: communityRevisions.revisionNumber,
    status: communityRevisions.status, snapshot: communityRevisions.snapshot,
  }).from(communityRevisions).where(and(eq(communityRevisions.id, materialId), eq(communityRevisions.workId, workId))) : [];
  const snapshot = parseCommunitySnapshot(revision?.snapshot);
  if (revision && !snapshot) throw new AppError('STATE_CONFLICT', '作品快照不可读取');
  return {
    id: work.id, version: work.version, lifecycleStatus: work.lifecycleStatus, commentsLocked: work.commentsLocked,
    featured: work.featuredAt !== null, isPublic: work.lifecycleStatus === 'active' && work.currentPublishedRevisionId !== null,
    canRestore: Boolean(approved), removedReason: work.removedReason,
    counts: { likes: work.likeCount, comments: work.commentCount, reuses: work.reuseCount },
    latestRevision: latest ?? null, material: revision && snapshot ? { ...revision, snapshot } : null,
  };
}

export type ManagedCommunityWork = Awaited<ReturnType<typeof listManagedCommunityWorks>>['items'][number];
export type ManagedWorkInspection = Awaited<ReturnType<typeof inspectManagedCommunityWork>>;
