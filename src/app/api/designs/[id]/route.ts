/**
 * /api/designs/[id]：GET 单个设计 / PUT 幂等 upsert（客户端 UUID）/ DELETE 墓碑删除（幂等 204）。
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { designs } from '@/../db/schema';
import { getSessionUserId } from '@/lib/auth/session';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { apiError, noContent, okJson, readJson } from '@/lib/auth/http';
import { designPutSchema } from '@/lib/schemas';
import { exceedsProjectLimit } from '@/lib/sync/limits';
import { LIMITS } from '@/lib/appInfo';
import { AppError } from '@/lib/errors';
import type { ProjectFile } from '@/lib/types';

const idSchema = z.string().uuid('设计 id 必须为 UUID');

function toProject(value: unknown): ProjectFile | null {
  return value && typeof value === 'object' ? (value as ProjectFile) : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return apiError(new AppError('NOT_FOUND', '设计不存在'));
  const db = getDb();
  const rows = await db
    .select({ id: designs.id, name: designs.name, project: designs.project, updatedAt: designs.updatedAt })
    .from(designs)
    .where(and(eq(designs.userId, userId), eq(designs.id, id), isNull(designs.deletedAt)));
  if (rows.length === 0) return apiError(new AppError('NOT_FOUND', '设计不存在'));
  const row = rows[0];
  return okJson({
    id: row.id,
    name: row.name,
    project: toProject(row.project),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const userId = await getSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return apiError(new AppError('VALIDATION', '设计 id 必须为 UUID'));

  const parsed = await readJson(request, LIMITS.projectFileBytes + 64 * 1024);
  if (!parsed.ok) return parsed.response;
  const result = designPutSchema.safeParse(parsed.data);
  if (!result.success) return apiError(result.error);
  const { name, project } = result.data;
  if (exceedsProjectLimit(project)) {
    return apiError(new AppError('VALIDATION', '项目文件超过 5 MB 上限'));
  }

  const db = getDb();
  // 新建时检查数量上限（更新既有设计不受限）
  const existing = await db
    .select({ id: designs.id })
    .from(designs)
    .where(and(eq(designs.userId, userId), eq(designs.id, id), isNull(designs.deletedAt)));
  if (existing.length === 0) {
    const counted = await db
      .select({ n: designs.id })
      .from(designs)
      .where(and(eq(designs.userId, userId), isNull(designs.deletedAt)));
    if (counted.length >= LIMITS.designsPerUser) {
      return apiError(new AppError('CONFLICT', `设计数量已达上限（${LIMITS.designsPerUser} 个）`));
    }
  }

  const updatedAt = new Date();
  await db
    .insert(designs)
    .values({ id, userId, name, project, updatedAt, deletedAt: null })
    .onConflictDoUpdate({
      target: designs.id,
      set: { name, project, updatedAt, deletedAt: null }, // upsert 复活墓碑（spec：墓碑不可见但可恢复）
    });

  return okJson(
    {
      id,
      name,
      width: project.pattern.width,
      height: project.pattern.height,
      updatedAt: updatedAt.toISOString(),
    },
    { status: 200 },
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const userId = await getSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return noContent(); // 幂等：非法 id 同样 204
  const db = getDb();
  await db
    .update(designs)
    .set({ deletedAt: new Date() })
    .where(and(eq(designs.userId, userId), eq(designs.id, id), isNull(designs.deletedAt)));
  return noContent(); // 幂等删除（不存在/已删/越权均 204，不泄露信息）
}
