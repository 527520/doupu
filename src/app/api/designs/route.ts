/**
 * GET /api/designs：当前用户的设计列表（spec §4.2；墓碑不可见，按 updatedAt 降序）。
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/auth/db';
import { designs } from '@/../db/schema';
import { getSessionUserId } from '@/lib/auth/session';
import { apiError, okJson } from '@/lib/auth/http';
import { AppError } from '@/lib/errors';
import type { ProjectFile } from '@/lib/types';

function toProject(value: unknown): ProjectFile | null {
  return value && typeof value === 'object' ? (value as ProjectFile) : null;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const db = getDb();
  const rows = await db
    .select({ id: designs.id, name: designs.name, project: designs.project, updatedAt: designs.updatedAt })
    .from(designs)
    .where(and(eq(designs.userId, userId), isNull(designs.deletedAt)))
    .orderBy(desc(designs.updatedAt));
  return okJson(
    rows.map((row) => {
      const project = toProject(row.project);
      return {
        id: row.id,
        name: row.name,
        width: project?.pattern?.width ?? 0,
        height: project?.pattern?.height ?? 0,
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
  );
}
