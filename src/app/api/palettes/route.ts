/**
 * GET /api/palettes：当前用户的自定义色板列表（spec §4.2；墓碑不可见）。
 */
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { getDb } from '@/lib/auth/db';
import { palettes } from '@/../db/schema';
import { getVerifiedSessionUserId } from '@/lib/auth/session';
import { apiError, okJson, withApiErrors } from '@/lib/auth/http';
import { AppError } from '@/lib/errors';
import type { CustomPaletteColor } from '@/lib/types';
import { decodeDesignCursor, DESIGN_PAGE_SIZE, encodeDesignCursor } from '@/lib/sync/revision';

function toColors(value: unknown): CustomPaletteColor[] {
  return Array.isArray(value) ? (value as CustomPaletteColor[]) : [];
}

async function get(request: Request = new Request('http://localhost/api/palettes')) {
  const userId = await getVerifiedSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const db = getDb();
  // 墓碑清理只在写路径与每日任务里做（A-06）：GET 保持只读。
  const cursorValue = new URL(request.url).searchParams.get('cursor');
  const cursor = cursorValue ? decodeDesignCursor(cursorValue) : null;
  if (cursorValue && !cursor) return apiError(new AppError('VALIDATION', '分页游标无效'));
  const cursorWhere = cursor
    ? or(lt(palettes.updatedAt, new Date(cursor.updatedAt)), and(eq(palettes.updatedAt, new Date(cursor.updatedAt)), lt(palettes.id, cursor.id)))
    : undefined;
  const rows = await db
    .select({ id: palettes.id, name: palettes.name, colors: palettes.colors, updatedAt: palettes.updatedAt, deletedAt: palettes.deletedAt, revision: palettes.revision })
    .from(palettes)
    .where(and(eq(palettes.userId, userId), cursorWhere))
    .orderBy(desc(palettes.updatedAt), desc(palettes.id))
    .limit(DESIGN_PAGE_SIZE + 1);
  const items = rows.slice(0, DESIGN_PAGE_SIZE).map((row) => ({
      id: row.id,
      name: row.name,
      colors: toColors(row.colors),
      updatedAt: row.updatedAt.toISOString(),
      deleted: row.deletedAt !== null,
      revision: row.revision,
    }));
  const last = items.at(-1);
  return okJson({ items, nextCursor: rows.length > DESIGN_PAGE_SIZE && last ? encodeDesignCursor({ updatedAt: last.updatedAt, id: last.id }) : null });
}

export const GET = withApiErrors(get);
