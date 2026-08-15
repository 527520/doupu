/**
 * GET /api/palettes：当前用户的自定义色板列表（spec §4.2；墓碑不可见）。
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/auth/db';
import { palettes } from '@/../db/schema';
import { getVerifiedSessionUserId } from '@/lib/auth/session';
import { apiError, okJson } from '@/lib/auth/http';
import { AppError } from '@/lib/errors';
import type { CustomPaletteColor } from '@/lib/types';

function toColors(value: unknown): CustomPaletteColor[] {
  return Array.isArray(value) ? (value as CustomPaletteColor[]) : [];
}

export async function GET() {
  const userId = await getVerifiedSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const db = getDb();
  const rows = await db
    .select({ id: palettes.id, name: palettes.name, colors: palettes.colors, updatedAt: palettes.updatedAt })
    .from(palettes)
    .where(and(eq(palettes.userId, userId), isNull(palettes.deletedAt)))
    .orderBy(desc(palettes.updatedAt));
  return okJson(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      colors: toColors(row.colors),
      updatedAt: row.updatedAt.toISOString(),
    })),
  );
}
