/**
 * /api/palettes/[id]：GET 单个色板 / PUT 幂等 upsert（客户端 UUID）/ DELETE 墓碑删除（幂等 204）。
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { palettes } from '@/../db/schema';
import { getSessionUserId } from '@/lib/auth/session';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, noContent, okJson, readJson } from '@/lib/auth/http';
import { palettePutSchema } from '@/lib/schemas';
import { LIMITS } from '@/lib/appInfo';
import { AppError } from '@/lib/errors';
import type { CustomPaletteColor } from '@/lib/types';

const idSchema = z.string().uuid('色板 id 必须为 UUID');

function toColors(value: unknown): CustomPaletteColor[] {
  return Array.isArray(value) ? (value as CustomPaletteColor[]) : [];
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return apiError(new AppError('NOT_FOUND', '色板不存在'));
  const db = getDb();
  const rows = await db
    .select({ id: palettes.id, name: palettes.name, colors: palettes.colors, updatedAt: palettes.updatedAt })
    .from(palettes)
    .where(and(eq(palettes.userId, userId), eq(palettes.id, id), isNull(palettes.deletedAt)));
  if (rows.length === 0) return apiError(new AppError('NOT_FOUND', '色板不存在'));
  const row = rows[0];
  return okJson({
    id: row.id,
    name: row.name,
    colors: toColors(row.colors),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const userId = await getSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return apiError(new AppError('VALIDATION', '色板 id 必须为 UUID'));

  const parsed = await readJson(request, 1024 * 1024); // 500 色板远小于 1MB
  if (!parsed.ok) return parsed.response;
  const result = palettePutSchema.safeParse(parsed.data);
  if (!result.success) return apiError(result.error);
  const { name, colors } = result.data;

  const db = getDb();
  const existing = await db
    .select({ id: palettes.id })
    .from(palettes)
    .where(and(eq(palettes.userId, userId), eq(palettes.id, id), isNull(palettes.deletedAt)));
  if (existing.length === 0) {
    const counted = await db
      .select({ id: palettes.id })
      .from(palettes)
      .where(and(eq(palettes.userId, userId), isNull(palettes.deletedAt)));
    if (counted.length >= LIMITS.palettesPerUser) {
      return apiError(new AppError('CONFLICT', `色板数量已达上限（${LIMITS.palettesPerUser} 个）`));
    }
  }

  const updatedAt = new Date();
  await db
    .insert(palettes)
    .values({ id, userId, name, colors, updatedAt, deletedAt: null })
    .onConflictDoUpdate({
      target: palettes.id,
      set: { name, colors, updatedAt, deletedAt: null },
    });

  return okJson({ id, name, colors, updatedAt: updatedAt.toISOString() }, { status: 200 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const userId = await getSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return noContent();
  const db = getDb();
  await db
    .update(palettes)
    .set({ deletedAt: new Date() })
    .where(and(eq(palettes.userId, userId), eq(palettes.id, id), isNull(palettes.deletedAt)));
  return noContent();
}
