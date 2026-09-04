import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDatabase } from '@/../db/client';
import {
  communityRevisions,
  communityRevisionTags,
  communityTags,
  communityWorks,
  users,
} from '@/../db/schema';
import { BOARD_PROFILE_IDS } from '@/lib/boardProfiles';
import { ANONYMIZED_DISPLAY_NAME } from '@/lib/identity/publicAuthor';
import { AppError } from '@/lib/errors';
import { communityPreviewSchema, parseCommunitySnapshot } from './snapshot';

export const COMMUNITY_PAGE_SIZE = 24;

const querySchema = z.object({
  q: z.string().trim().max(80).optional(),
  author: z.string().trim().max(80).optional(),
  tag: z.string().trim().max(80).optional(),
  boardProfile: z.enum(BOARD_PROFILE_IDS).optional(),
  palette: z.string().trim().max(200).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  sort: z.enum(['latest', 'featured', 'popular']).default('latest'),
  cursor: z.string().max(500).optional(),
}).strict();
export type CommunityListQuery = z.infer<typeof querySchema>;

const cursorSchema = z.object({
  sort: z.enum(['latest', 'featured', 'popular']),
  primary: z.number(),
  publishedAt: z.string().datetime(),
  id: z.string().uuid(),
}).strict();
type CommunityCursor = z.infer<typeof cursorSchema>;

export function parseCommunityListUrl(url: string): CommunityListQuery {
  const search = new URL(url).searchParams;
  const values: Record<string, string> = {};
  for (const key of ['q', 'author', 'tag', 'boardProfile', 'palette', 'from', 'to', 'sort', 'cursor']) {
    const value = search.get(key);
    if (value !== null && value !== '') values[key] = value;
  }
  return querySchema.parse(values);
}

function encodeCursor(cursor: CommunityCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined, sort: CommunityListQuery['sort']): CommunityCursor | null {
  if (!value) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return parsed.success && parsed.data.sort === sort ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface PublicAuthorDto {
  authorType: 'user' | 'official';
  publicAuthorId: string;
  displayName: string;
}

function publicAuthor(row: {
  authorType: 'user' | 'official';
  publicAuthorId: string;
  frozenDisplayName: string;
  accountStatus: 'active' | 'suspended' | 'anonymized' | null;
}): PublicAuthorDto {
  if (row.authorType === 'official') {
    return { authorType: 'official', publicAuthorId: 'doupu-official', displayName: '豆谱官方' };
  }
  return {
    authorType: 'user',
    publicAuthorId: row.publicAuthorId,
    displayName: row.accountStatus === 'anonymized' ? ANONYMIZED_DISPLAY_NAME : row.frozenDisplayName,
  };
}

const publicSelection = {
  id: communityWorks.id,
  revisionId: communityRevisions.id,
  title: communityRevisions.title,
  authorType: communityRevisions.authorType,
  publicAuthorId: communityRevisions.publicAuthorId,
  frozenDisplayName: communityRevisions.frozenDisplayName,
  accountStatus: users.accountStatus,
  boardProfile: communityRevisions.boardProfile,
  paletteKind: communityRevisions.paletteKind,
  paletteId: communityRevisions.paletteId,
  width: communityRevisions.width,
  height: communityRevisions.height,
  colorCount: communityRevisions.colorCount,
  preview: communityRevisions.preview,
  publishedAt: communityRevisions.publishedAt,
  featuredAt: communityWorks.featuredAt,
  likeCount: communityWorks.likeCount,
  commentCount: communityWorks.commentCount,
  reuseCount: communityWorks.reuseCount,
  commentsLocked: communityWorks.commentsLocked,
} as const;

function publicBaseConditions(): SQL[] {
  return [
    eq(communityWorks.lifecycleStatus, 'active'),
    eq(communityRevisions.status, 'published'),
    eq(communityWorks.currentPublishedRevisionId, communityRevisions.id),
  ];
}

async function tagsByRevision(db: AnyDatabase, revisionIds: string[]) {
  const result = new Map<string, Array<{ id: string; name: string; slug: string }>>();
  if (revisionIds.length === 0) return result;
  const rows = await db.select({
    revisionId: communityRevisionTags.revisionId,
    id: communityTags.id,
    name: communityTags.name,
    slug: communityTags.slug,
  }).from(communityRevisionTags).innerJoin(communityTags, eq(communityTags.id, communityRevisionTags.tagId))
    .where(inArray(communityRevisionTags.revisionId, revisionIds))
    .orderBy(communityTags.sortOrder, communityTags.name);
  for (const row of rows) result.set(row.revisionId, [...(result.get(row.revisionId) ?? []), { id: row.id, name: row.name, slug: row.slug }]);
  return result;
}

export async function listPublicCommunityWorks(db: AnyDatabase, queryInput: CommunityListQuery) {
  const query = querySchema.parse(queryInput);
  const cursor = decodeCursor(query.cursor, query.sort);
  if (query.cursor && !cursor) throw new AppError('VALIDATION', '分页游标无效', 'cursor');
  const score = sql<number>`${communityWorks.likeCount} + ${communityWorks.commentCount} + ${communityWorks.reuseCount}`;
  const featuredRank = sql<number>`coalesce(extract(epoch from ${communityWorks.featuredAt}), 0)`;
  const conditions = publicBaseConditions();
  if (query.q) conditions.push(ilike(communityRevisions.title, `%${query.q}%`));
  if (query.author) conditions.push(or(
    ilike(communityRevisions.frozenDisplayName, `%${query.author}%`),
    ilike(communityRevisions.publicAuthorId, `%${query.author}%`),
  )!);
  if (query.tag) conditions.push(sql`exists (
    select 1 from ${communityRevisionTags} crt
    inner join ${communityTags} ct on ct.id = crt.tag_id
    where crt.revision_id = ${communityRevisions.id} and ct.slug = ${query.tag}
  )`);
  if (query.boardProfile) conditions.push(eq(communityRevisions.boardProfile, query.boardProfile));
  if (query.palette) conditions.push(eq(communityRevisions.paletteId, query.palette));
  if (query.from) conditions.push(gte(communityRevisions.publishedAt, new Date(`${query.from}T00:00:00+08:00`)));
  if (query.to) conditions.push(lt(communityRevisions.publishedAt, new Date(new Date(`${query.to}T00:00:00+08:00`).getTime() + 24 * 60 * 60 * 1000)));
  if (cursor) {
    const publishedAt = new Date(cursor.publishedAt);
    const primary = query.sort === 'popular' ? score : query.sort === 'featured' ? featuredRank : sql<number>`extract(epoch from ${communityRevisions.publishedAt})`;
    conditions.push(or(
      lt(primary, cursor.primary),
      and(eq(primary, cursor.primary), lt(communityRevisions.publishedAt, publishedAt)),
      and(eq(primary, cursor.primary), eq(communityRevisions.publishedAt, publishedAt), lt(communityWorks.id, cursor.id)),
    )!);
  }
  const primary = query.sort === 'popular' ? score : query.sort === 'featured' ? featuredRank : sql<number>`extract(epoch from ${communityRevisions.publishedAt})`;
  const rows = await db.select({ ...publicSelection, primary }).from(communityWorks)
    .innerJoin(communityRevisions, eq(communityRevisions.workId, communityWorks.id))
    .leftJoin(users, eq(users.id, communityWorks.authorUserId))
    .where(and(...conditions))
    .orderBy(desc(primary), desc(communityRevisions.publishedAt), desc(communityWorks.id))
    .limit(COMMUNITY_PAGE_SIZE + 1);
  const visible = rows.slice(0, COMMUNITY_PAGE_SIZE);
  const tags = await tagsByRevision(db, visible.map((row) => row.revisionId));
  const items = visible.flatMap((row) => {
    const preview = communityPreviewSchema.safeParse(row.preview);
    if (!preview.success || !row.publishedAt) return [];
    return [{
      id: row.id,
      revisionId: row.revisionId,
      title: row.title,
      author: publicAuthor(row),
      boardProfile: row.boardProfile,
      palette: { kind: row.paletteKind, id: row.paletteId },
      width: row.width,
      height: row.height,
      colorCount: row.colorCount,
      preview: preview.data,
      tags: tags.get(row.revisionId) ?? [],
      counts: { likes: row.likeCount, comments: row.commentCount, reuses: row.reuseCount },
      featured: row.featuredAt !== null,
      publishedAt: row.publishedAt.toISOString(),
    }];
  });
  const last = visible.at(-1);
  return {
    items,
    nextCursor: rows.length > COMMUNITY_PAGE_SIZE && last?.publishedAt ? encodeCursor({
      sort: query.sort,
      primary: Number(last.primary),
      publishedAt: last.publishedAt.toISOString(),
      id: last.id,
    }) : null,
  };
}

export async function getPublicCommunityWork(db: AnyDatabase, id: string) {
  const [row] = await db.select({ ...publicSelection, snapshot: communityRevisions.snapshot })
    .from(communityWorks)
    .innerJoin(communityRevisions, eq(communityRevisions.workId, communityWorks.id))
    .leftJoin(users, eq(users.id, communityWorks.authorUserId))
    .where(and(eq(communityWorks.id, id), ...publicBaseConditions()));
  if (!row || !row.publishedAt) return null;
  const snapshot = parseCommunitySnapshot(row.snapshot);
  const preview = communityPreviewSchema.safeParse(row.preview);
  if (!snapshot || !preview.success) return null;
  const tags = await tagsByRevision(db, [row.revisionId]);
  return {
    id: row.id,
    revisionId: row.revisionId,
    title: row.title,
    author: publicAuthor(row),
    boardProfile: row.boardProfile,
    palette: { kind: row.paletteKind, id: row.paletteId },
    width: row.width,
    height: row.height,
    colorCount: row.colorCount,
    preview: preview.data,
    snapshot,
    tags: tags.get(row.revisionId) ?? [],
    counts: { likes: row.likeCount, comments: row.commentCount, reuses: row.reuseCount },
    featured: row.featuredAt !== null,
    publishedAt: row.publishedAt.toISOString(),
    commentsLocked: row.commentsLocked,
  };
}

export async function listOwnCommunityWorks(db: AnyDatabase, userId: string) {
  const works = await db.select({
    id: communityWorks.id,
    lifecycleStatus: communityWorks.lifecycleStatus,
    version: communityWorks.version,
    currentPublishedRevisionId: communityWorks.currentPublishedRevisionId,
    createdAt: communityWorks.createdAt,
    updatedAt: communityWorks.updatedAt,
  }).from(communityWorks).where(eq(communityWorks.authorUserId, userId))
    .orderBy(desc(communityWorks.updatedAt), desc(communityWorks.id));
  if (works.length === 0) return [];
  const revisions = await db.select({
    id: communityRevisions.id,
    workId: communityRevisions.workId,
    revisionNumber: communityRevisions.revisionNumber,
    title: communityRevisions.title,
    status: communityRevisions.status,
    version: communityRevisions.version,
    preview: communityRevisions.preview,
    submittedAt: communityRevisions.submittedAt,
    reviewReason: communityRevisions.reviewReason,
    createdAt: communityRevisions.createdAt,
  }).from(communityRevisions).where(inArray(communityRevisions.workId, works.map((work) => work.id)))
    .orderBy(desc(communityRevisions.revisionNumber));
  const byWork = new Map<string, typeof revisions>();
  for (const revision of revisions) byWork.set(revision.workId, [...(byWork.get(revision.workId) ?? []), revision]);
  return works.map((work) => ({
    ...work,
    createdAt: work.createdAt.toISOString(),
    updatedAt: work.updatedAt.toISOString(),
    revisions: (byWork.get(work.id) ?? []).flatMap((revision) => {
      const preview = communityPreviewSchema.safeParse(revision.preview);
      return preview.success ? [{
        ...revision,
        preview: preview.data,
        submittedAt: revision.submittedAt?.toISOString() ?? null,
        createdAt: revision.createdAt.toISOString(),
      }] : [];
    }),
  }));
}

export async function listCommunityReviewQueue(db: AnyDatabase) {
  const rows = await db.select({
    revisionId: communityRevisions.id,
    workId: communityRevisions.workId,
    revisionNumber: communityRevisions.revisionNumber,
    title: communityRevisions.title,
    version: communityRevisions.version,
    publicAuthorId: communityRevisions.publicAuthorId,
    frozenDisplayName: communityRevisions.frozenDisplayName,
    authorType: communityRevisions.authorType,
    preview: communityRevisions.preview,
    width: communityRevisions.width,
    height: communityRevisions.height,
    colorCount: communityRevisions.colorCount,
    boardProfile: communityRevisions.boardProfile,
    submittedAt: communityRevisions.submittedAt,
  }).from(communityRevisions).innerJoin(communityWorks, eq(communityWorks.id, communityRevisions.workId))
    .where(and(eq(communityRevisions.status, 'pending_review'), eq(communityWorks.lifecycleStatus, 'active')))
    .orderBy(communityRevisions.submittedAt, communityRevisions.id)
    .limit(100);
  return rows.flatMap((row) => {
    const preview = communityPreviewSchema.safeParse(row.preview);
    return preview.success ? [{
      ...row,
      author: row.authorType === 'official'
        ? { authorType: 'official' as const, publicAuthorId: 'doupu-official', displayName: '豆谱官方' }
        : { authorType: 'user' as const, publicAuthorId: row.publicAuthorId, displayName: row.frozenDisplayName },
      preview: preview.data,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      publicAuthorId: undefined,
      frozenDisplayName: undefined,
      authorType: undefined,
    }] : [];
  });
}
