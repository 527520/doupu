/**
 * /api/palettes/[id]：GET 单个色板 / PUT 幂等 upsert（客户端 UUID）/ DELETE 墓碑删除（幂等 204）。
 */
import { and, count, eq, isNull, lt, sql, sum } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { palettes } from '@/../db/schema';
import { getVerifiedSessionUserId } from '@/lib/auth/session';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, noContent, okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { palettePutSchema, revisionDeleteSchema } from '@/lib/schemas';
import { LIMITS } from '@/lib/appInfo';
import { AppError } from '@/lib/errors';
import type { CustomPaletteColor } from '@/lib/types';
import { measureJsonBytes, tombstoneCutoff } from '@/lib/sync/revision';

const idSchema = z.string().uuid('色板 id 必须为 UUID');

function toColors(value: unknown): CustomPaletteColor[] {
  return Array.isArray(value) ? (value as CustomPaletteColor[]) : [];
}

async function get(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getVerifiedSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return apiError(new AppError('NOT_FOUND', '色板不存在'));
  const db = getDb();
  const rows = await db
    .select({ id: palettes.id, name: palettes.name, colors: palettes.colors, updatedAt: palettes.updatedAt, revision: palettes.revision })
    .from(palettes)
    .where(and(eq(palettes.userId, userId), eq(palettes.id, id), isNull(palettes.deletedAt)));
  if (rows.length === 0) return apiError(new AppError('NOT_FOUND', '色板不存在'));
  const row = rows[0];
  return okJson({
    id: row.id,
    name: row.name,
    colors: toColors(row.colors),
    updatedAt: row.updatedAt.toISOString(),
    revision: row.revision,
  });
}

async function put(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const userId = await getVerifiedSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return apiError(new AppError('VALIDATION', '色板 id 必须为 UUID'));

  const parsed = await readJson(request, 1024 * 1024); // 500 色板远小于 1MB
  if (!parsed.ok) return parsed.response;
  const result = palettePutSchema.safeParse(parsed.data);
  if (!result.success) return apiError(result.error);
  const { name, colors, baseRevision } = result.data;

  const db = getDb();
  const payloadBytes = measureJsonBytes(colors);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${userId} for update`);
    await tx.delete(palettes).where(and(eq(palettes.userId, userId), lt(palettes.deletedAt, tombstoneCutoff())));
    const existing = (await tx.select().from(palettes).where(and(eq(palettes.userId, userId), eq(palettes.id, id))))[0];
    if (existing) {
      if (existing.revision !== baseRevision) return apiError(new AppError('REVISION_CONFLICT', '云端版本已更新'));
      const usage = (await tx.select({ active: count(sql`case when ${palettes.deletedAt} is null then 1 end`), bytes: sum(palettes.payloadBytes) }).from(palettes).where(eq(palettes.userId, userId)))[0];
      if (existing.deletedAt && Number(usage.active) >= LIMITS.palettesPerUser) return apiError(new AppError('CONFLICT', `色板数量已达上限（${LIMITS.palettesPerUser} 个）`));
      if (Number(usage.bytes ?? 0) - existing.payloadBytes + payloadBytes > LIMITS.paletteBytesPerUser) return apiError(new AppError('CONFLICT', '色板总存储空间已达上限'));
      const updatedAt = new Date();
      const revision = baseRevision + 1;
      await tx.update(palettes).set({ name, colors, payloadBytes, updatedAt, deletedAt: null, revision }).where(and(eq(palettes.userId, userId), eq(palettes.id, id), eq(palettes.revision, baseRevision)));
      return okJson({ id, name, colors, updatedAt: updatedAt.toISOString(), revision });
    }
    if (baseRevision !== 0) return apiError(new AppError('REVISION_CONFLICT', '云端版本已更新'));
    const occupied = await tx.select({ userId: palettes.userId }).from(palettes).where(eq(palettes.id, id));
    if (occupied.length > 0) return apiError(new AppError('CONFLICT', '该色板 id 已被占用，请重新保存'));
    const usage = (await tx.select({ total: count(), active: count(sql`case when ${palettes.deletedAt} is null then 1 end`), bytes: sum(palettes.payloadBytes) }).from(palettes).where(eq(palettes.userId, userId)))[0];
    if (Number(usage.active) >= LIMITS.palettesPerUser || Number(usage.total) >= LIMITS.paletteRowsPerUser) return apiError(new AppError('CONFLICT', `色板数量已达上限（${LIMITS.palettesPerUser} 个）`));
    if (Number(usage.bytes ?? 0) + payloadBytes > LIMITS.paletteBytesPerUser) return apiError(new AppError('CONFLICT', '色板总存储空间已达上限'));
    const updatedAt = new Date();
    const inserted = await tx.insert(palettes).values({ id, userId, name, colors, payloadBytes, updatedAt, deletedAt: null, revision: 1 }).onConflictDoNothing().returning();
    if (inserted.length === 0) return apiError(new AppError('CONFLICT', '该色板 id 已被占用，请重新保存'));
    return okJson({ id, name, colors, updatedAt: updatedAt.toISOString(), revision: 1 });
  });
}

async function del(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const userId = await getVerifiedSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return noContent();
  const parsed = await readJson(request, 1024);
  if (!parsed.ok) return parsed.response;
  const result = revisionDeleteSchema.safeParse(parsed.data);
  if (!result.success) return apiError(result.error);
  const { baseRevision } = result.data;
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${userId} for update`);
    await tx.delete(palettes).where(and(eq(palettes.userId, userId), lt(palettes.deletedAt, tombstoneCutoff())));
    const rows = await tx.select({ revision: palettes.revision, deletedAt: palettes.deletedAt, updatedAt: palettes.updatedAt }).from(palettes).where(and(eq(palettes.userId, userId), eq(palettes.id, id)));
    if (rows.length === 0) return okJson({ revision: baseRevision, updatedAt: new Date().toISOString() });
    if (rows[0].deletedAt && rows[0].revision === baseRevision + 1) return okJson({ revision: rows[0].revision, updatedAt: rows[0].updatedAt.toISOString() });
    if (rows[0].revision !== baseRevision) return apiError(new AppError('REVISION_CONFLICT', '云端版本已更新'));
    const deletedAt = new Date();
    const revision = baseRevision + 1;
    await tx.update(palettes).set({ name: '', colors: null, payloadBytes: 0, updatedAt: deletedAt, deletedAt, revision }).where(and(eq(palettes.userId, userId), eq(palettes.id, id), eq(palettes.revision, baseRevision)));
    return okJson({ revision, updatedAt: deletedAt.toISOString() });
  });
}

export const GET = withApiErrors(get);
export const PUT = withApiErrors(put);
export const DELETE = withApiErrors(del);
