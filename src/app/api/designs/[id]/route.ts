/**
 * /api/designs/[id]：GET 单个设计 / PUT 幂等 upsert（客户端 UUID）/ DELETE 墓碑删除（幂等 204）。
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { designs } from '@/../db/schema';
import { getVerifiedSessionUserId } from '@/lib/auth/session';
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
  const userId = await getVerifiedSessionUserId();
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
  const userId = await getVerifiedSessionUserId();
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
  // 安全（IDOR 修复）：upsert 仅在目标行属于当前用户时生效（setWhere）；
  // 若该 id 已被其他用户占用，DO UPDATE 被跳过（等价 DO NOTHING），随后校验返回 409。
  await db
    .insert(designs)
    .values({ id, userId, name, project, updatedAt, deletedAt: null })
    .onConflictDoUpdate({
      target: designs.id,
      set: { name, project, updatedAt, deletedAt: null }, // upsert 复活墓碑（spec：墓碑不可见但可恢复）
      setWhere: eq(designs.userId, userId),
    });
  const ownership = await db.select({ userId: designs.userId }).from(designs).where(eq(designs.id, id));
  if (ownership.length === 0 || ownership[0].userId !== userId) {
    return apiError(new AppError('CONFLICT', '该设计 id 已被占用，请重新保存'));
  }

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
  const userId = await getVerifiedSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return noContent(); // 幂等：非法 id 同样 204
  const db = getDb();
  const deletedAt = new Date();
  await db
    .update(designs)
    .set({ deletedAt, updatedAt: deletedAt }) // updatedAt=删除时间：LWW 墓碑传播（跨设备删除收敛）
    .where(and(eq(designs.userId, userId), eq(designs.id, id), isNull(designs.deletedAt)));
  return noContent(); // 幂等删除（不存在/已删/越权均 204，不泄露信息）
}
