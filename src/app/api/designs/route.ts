/**
 * GET /api/designs：当前用户的设计列表（spec §4.2）。
 * 含墓碑条目（deleted=true）：客户端同步使用单调 revision 做 CAS，
 * 冲突时保留云端原件和本地冲突副本；UI 层自行过滤墓碑。
 */
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { getDb } from '@/lib/auth/db';
import { designs } from '@/../db/schema';
import { getVerifiedSessionUserId } from '@/lib/auth/session';
import { apiError, okJson, withApiErrors } from '@/lib/auth/http';
import { AppError } from '@/lib/errors';
import type { ProjectFile } from '@/lib/types';
import { decodeDesignCursor, DESIGN_PAGE_SIZE, encodeDesignCursor } from '@/lib/sync/revision';

function toProject(value: unknown): ProjectFile | null {
  return value && typeof value === 'object' ? (value as ProjectFile) : null;
}

async function get(request: Request = new Request('http://localhost/api/designs')) {
  const userId = await getVerifiedSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const db = getDb();
  // 墓碑清理只在写路径与 instrumentation 的每日任务里做（A-06）：
  // GET 必须是安全方法，否则路由预取/代理重放都会放大这次删除。
  const cursorValue = new URL(request.url).searchParams.get('cursor');
  const cursor = cursorValue ? decodeDesignCursor(cursorValue) : null;
  if (cursorValue && !cursor) return apiError(new AppError('VALIDATION', '分页游标无效'));
  const cursorWhere = cursor
    ? or(
        lt(designs.updatedAt, new Date(cursor.updatedAt)),
        and(eq(designs.updatedAt, new Date(cursor.updatedAt)), lt(designs.id, cursor.id)),
      )
    : undefined;
  const rows = await db
    .select({ id: designs.id, name: designs.name, project: designs.project, updatedAt: designs.updatedAt, deletedAt: designs.deletedAt, revision: designs.revision })
    .from(designs)
    .where(and(eq(designs.userId, userId), cursorWhere))
    .orderBy(desc(designs.updatedAt), desc(designs.id))
    .limit(DESIGN_PAGE_SIZE + 1);
  const items = rows.slice(0, DESIGN_PAGE_SIZE).map((row) => {
      const project = toProject(row.project);
      return {
        id: row.id,
        name: row.name,
        width: project?.pattern?.width ?? 0,
        height: project?.pattern?.height ?? 0,
        updatedAt: row.updatedAt.toISOString(),
        deleted: row.deletedAt !== null,
        revision: row.revision,
      };
    });
  const last = items.at(-1);
  return okJson({
    items,
    nextCursor: rows.length > DESIGN_PAGE_SIZE && last
      ? encodeDesignCursor({ updatedAt: last.updatedAt, id: last.id })
      : null,
  });
}

export const GET = withApiErrors(get);
