/**
 * 作品原图（D49）业务规则。
 *
 * - 公开作品必须附带原图：草稿阶段由作者（或官方批量的管理员）上传，提交审核 / 发布前校验存在。
 * - 原图绝不公开：只有作品作者、审核员/管理员、以及成功引用过该修订的用户可以取回。
 * - 生命周期：作者撤回、注销、修订被驳回 → 立即删除；管理员下架 → 先封禁，30 天未恢复再删除；
 *   被新版替代的修订若仍有引用记录则保留（引用者需要它继续调参）。
 * - 对象删除是外部 I/O：事务内只标记 deleted_at，提交后再尽力清除对象；未清除的由维护任务补扫。
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import {
  communityOriginals,
  communityReuses,
  communityRevisions,
  communityWorks,
} from '@/../db/schema';
import { authorize, type Actor } from '@/lib/auth/authorization';
import { AppError } from '@/lib/errors';
import { validateImageFile } from '@/lib/image/validation';
import { readImageDimensions } from '@/lib/image/dimensions';
import type { ImageType } from '@/lib/image/sniff';
import type { OriginalObjectStore } from './originalStore';

export const ORIGINAL_BLOCK_RETENTION_DAYS = 30;

const MIME_BY_TYPE: Record<ImageType, string> = {
  jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
};
const EXTENSION_BY_TYPE: Record<ImageType, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', heic: 'heic' };

export interface OriginalSummary {
  revisionId: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  sha256: string;
}

function summarize(row: typeof communityOriginals.$inferSelect): OriginalSummary {
  return { revisionId: row.revisionId, mimeType: row.mimeType, byteSize: row.byteSize, width: row.width, height: row.height, sha256: row.sha256 };
}

async function loadRevisionForUpload(tx: AnyDatabase, revisionId: string) {
  const [row] = await tx.select({
    id: communityRevisions.id, workId: communityRevisions.workId, status: communityRevisions.status,
    authorType: communityRevisions.authorType, authorUserId: communityWorks.authorUserId, lifecycleStatus: communityWorks.lifecycleStatus,
  }).from(communityRevisions).innerJoin(communityWorks, eq(communityWorks.id, communityRevisions.workId))
    .where(eq(communityRevisions.id, revisionId)).for('update');
  return row ?? null;
}

/** 上传（或替换）某草稿修订的原图。校验文件后写对象、再写行；旧对象在无其它引用时清除。 */
export async function storeRevisionOriginal(db: AnyDatabase, store: OriginalObjectStore, input: {
  actor: Actor; revisionId: string; bytes: Uint8Array; now?: Date;
}): Promise<OriginalSummary> {
  const validation = validateImageFile({ bytes: input.bytes, name: 'original' });
  if (!validation.ok) throw new AppError('VALIDATION', `原图不可用：${validation.code}`, 'original');
  const dimensions = readImageDimensions(input.bytes, validation.type);
  const now = input.now ?? new Date();
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const cosKey = `originals/${input.revisionId}/${sha256}.${EXTENSION_BY_TYPE[validation.type]}`;
  const mimeType = MIME_BY_TYPE[validation.type];

  // 先校验权限与状态（不占用长事务做上传），再写对象，最后在短事务里落行。
  const revision = await db.transaction(async (tx) => {
    const row = await loadRevisionForUpload(tx, input.revisionId);
    if (!row) throw new AppError('NOT_FOUND', '修订不存在');
    const isAuthor = row.authorType === 'user' && row.authorUserId === input.actor.userId;
    const isOfficialManager = row.authorType === 'official' && authorize(input.actor, 'official:manage');
    if (!isAuthor && !isOfficialManager) throw new AppError('FORBIDDEN', '只有作品作者可以上传原图');
    if (row.status !== 'draft' || row.lifecycleStatus !== 'active') throw new AppError('STATE_CONFLICT', '只能为草稿修订上传原图');
    return row;
  });
  await store.put(cosKey, input.bytes, mimeType);
  const replaced = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(communityOriginals).where(eq(communityOriginals.revisionId, revision.id)).for('update');
    const values = {
      workId: revision.workId, cosKey, mimeType, byteSize: input.bytes.byteLength, sha256,
      width: dimensions?.width ?? null, height: dimensions?.height ?? null,
      uploadedByUserId: input.actor.userId, createdAt: now, blockedAt: null, deletedAt: null, purgedAt: null,
    };
    if (existing) {
      const [updated] = await tx.update(communityOriginals).set(values).where(eq(communityOriginals.id, existing.id)).returning();
      return { row: updated, previousKey: existing.cosKey !== cosKey ? existing.cosKey : null };
    }
    const [created] = await tx.insert(communityOriginals).values({ revisionId: revision.id, ...values }).returning();
    return { row: created, previousKey: null };
  });
  if (replaced.previousKey) await deleteObjectIfUnreferenced(db, store, replaced.previousKey);
  return summarize(replaced.row);
}

/** 新修订沿用上一版原图：复制行、共享对象键。没有可沿用的原图时返回 null。 */
export async function inheritRevisionOriginal(tx: AnyDatabase, input: { fromRevisionId: string; toRevisionId: string; workId: string; actorUserId: string; now?: Date }): Promise<OriginalSummary | null> {
  const [source] = await tx.select().from(communityOriginals)
    .where(and(eq(communityOriginals.revisionId, input.fromRevisionId), isNull(communityOriginals.deletedAt)));
  if (!source) return null;
  const [created] = await tx.insert(communityOriginals).values({
    revisionId: input.toRevisionId, workId: input.workId, cosKey: source.cosKey, mimeType: source.mimeType,
    byteSize: source.byteSize, sha256: source.sha256, width: source.width, height: source.height,
    uploadedByUserId: input.actorUserId, createdAt: input.now ?? new Date(),
  }).onConflictDoNothing().returning();
  return created ? summarize(created) : null;
}

export async function findRevisionOriginal(db: AnyDatabase, revisionId: string) {
  const [row] = await db.select().from(communityOriginals)
    .where(and(eq(communityOriginals.revisionId, revisionId), isNull(communityOriginals.deletedAt)));
  return row ?? null;
}

/** 提交审核 / 官方发布前的门禁。 */
export async function assertRevisionHasOriginal(tx: AnyDatabase, revisionId: string): Promise<void> {
  const row = await findRevisionOriginal(tx, revisionId);
  if (!row) throw new AppError('ORIGINAL_REQUIRED', '公开作品必须附带原图，请先上传原图');
}

export type OriginalAccess = 'author' | 'moderator' | 'reuser';

/** 判定访问资格；无资格返回 null。封禁中的原图只对审核员开放。 */
export async function resolveOriginalAccess(db: AnyDatabase, actor: Actor | null, revisionId: string): Promise<{ access: OriginalAccess; row: typeof communityOriginals.$inferSelect } | null> {
  if (!actor || actor.accountStatus !== 'active') return null;
  const row = await findRevisionOriginal(db, revisionId);
  if (!row) return null;
  if (authorize(actor, 'community:moderate')) return { access: 'moderator', row };
  if (row.blockedAt) return null;
  const [work] = await db.select({ authorUserId: communityWorks.authorUserId, lifecycleStatus: communityWorks.lifecycleStatus })
    .from(communityWorks).where(eq(communityWorks.id, row.workId));
  if (!work) return null;
  if (work.authorUserId === actor.userId) return { access: 'author', row };
  const [reuse] = await db.select({ id: communityReuses.id }).from(communityReuses)
    .where(and(eq(communityReuses.revisionId, revisionId), eq(communityReuses.userId, actor.userId))).limit(1);
  if (reuse) return { access: 'reuser', row };
  return null;
}

export async function readRevisionOriginal(db: AnyDatabase, store: OriginalObjectStore, actor: Actor | null, revisionId: string) {
  const resolved = await resolveOriginalAccess(db, actor, revisionId);
  if (!resolved) throw new AppError('NOT_FOUND', '原图不存在或无权访问');
  const object = await store.get(resolved.row.cosKey);
  if (!object) throw new AppError('NOT_FOUND', '原图对象已不存在');
  return { ...resolved, body: object.body, contentType: object.contentType ?? resolved.row.mimeType };
}

/** 事务内标记删除；返回需要在提交后清除的对象键（已去重）。 */
export async function markOriginalsDeleted(tx: AnyDatabase, where: { workId?: string; revisionIds?: string[] }, now: Date): Promise<string[]> {
  const conditions = [isNull(communityOriginals.deletedAt)];
  if (where.workId) conditions.push(eq(communityOriginals.workId, where.workId));
  if (where.revisionIds) {
    if (where.revisionIds.length === 0) return [];
    conditions.push(inArray(communityOriginals.revisionId, where.revisionIds));
  }
  const rows = await tx.update(communityOriginals).set({ deletedAt: now }).where(and(...conditions)).returning();
  return [...new Set(rows.map((row) => row.cosKey))];
}

/** 被新版替代的修订：没有任何引用记录时删除其原图；有引用者则保留供其继续调参。 */
export async function retireSupersededOriginal(tx: AnyDatabase, revisionId: string, now: Date): Promise<string[]> {
  const [reuse] = await tx.select({ id: communityReuses.id }).from(communityReuses).where(eq(communityReuses.revisionId, revisionId)).limit(1);
  if (reuse) return [];
  return markOriginalsDeleted(tx, { revisionIds: [revisionId] }, now);
}

export async function blockWorkOriginals(tx: AnyDatabase, workId: string, now: Date): Promise<void> {
  await tx.update(communityOriginals).set({ blockedAt: now })
    .where(and(eq(communityOriginals.workId, workId), isNull(communityOriginals.deletedAt), isNull(communityOriginals.blockedAt)));
}

export async function unblockWorkOriginals(tx: AnyDatabase, workId: string): Promise<void> {
  await tx.update(communityOriginals).set({ blockedAt: null })
    .where(and(eq(communityOriginals.workId, workId), isNull(communityOriginals.deletedAt)));
}

/** 仅当没有任何未删除行仍引用该对象键时才真正删除对象。 */
export async function deleteObjectIfUnreferenced(db: AnyDatabase, store: OriginalObjectStore, cosKey: string): Promise<boolean> {
  const [live] = await db.select({ count: sql<number>`count(*)::int` }).from(communityOriginals)
    .where(and(eq(communityOriginals.cosKey, cosKey), isNull(communityOriginals.deletedAt)));
  if (Number(live?.count ?? 0) > 0) return false;
  await store.delete(cosKey);
  return true;
}

/**
 * 清除已标记删除的对象：成功后置 purged_at。被其它未删除行共享的键只标记不删对象。
 * 供事务提交后的尽力清理与维护任务共用；失败留给下次补扫。
 */
export async function purgeDeletedOriginals(db: AnyDatabase, store: OriginalObjectStore, options: { limit?: number; keys?: string[] } = {}): Promise<{ purged: number; failed: number }> {
  const conditions = [sql`${communityOriginals.deletedAt} is not null`, isNull(communityOriginals.purgedAt)];
  if (options.keys) {
    if (options.keys.length === 0) return { purged: 0, failed: 0 };
    conditions.push(inArray(communityOriginals.cosKey, options.keys));
  }
  const rows = await db.select({ id: communityOriginals.id, cosKey: communityOriginals.cosKey }).from(communityOriginals)
    .where(and(...conditions)).limit(options.limit ?? 200);
  let purged = 0; let failed = 0;
  const handledKeys = new Set<string>();
  for (const row of rows) {
    try {
      if (!handledKeys.has(row.cosKey)) {
        await deleteObjectIfUnreferenced(db, store, row.cosKey);
        handledKeys.add(row.cosKey);
      }
      await db.update(communityOriginals).set({ purgedAt: new Date() }).where(eq(communityOriginals.id, row.id));
      purged += 1;
    } catch {
      failed += 1;
    }
  }
  return { purged, failed };
}

/** 事务提交后的尽力清理：失败不影响响应，维护任务会按 deleted_at 补扫。 */
export function purgeOriginalsSoon(db: AnyDatabase, store: OriginalObjectStore, keys: string[] | undefined): void {
  if (!keys || keys.length === 0) return;
  void purgeDeletedOriginals(db, store, { keys }).catch(() => undefined);
}

/** 下架超过保留期仍未恢复的作品原图：标记删除并清除对象。 */
export async function expireBlockedOriginals(db: AnyDatabase, store: OriginalObjectStore, now: Date = new Date()): Promise<{ expired: number; purged: number; failed: number }> {
  const cutoff = new Date(now.getTime() - ORIGINAL_BLOCK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.update(communityOriginals).set({ deletedAt: now })
    .where(and(isNull(communityOriginals.deletedAt), lt(communityOriginals.blockedAt, cutoff))).returning();
  const keys = [...new Set(rows.map((row) => row.cosKey))];
  const result = await purgeDeletedOriginals(db, store, { keys });
  return { expired: rows.length, ...result };
}
