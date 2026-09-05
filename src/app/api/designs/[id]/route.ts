/**
 * /api/designs/[id]：GET 单个设计 / PUT 幂等 upsert（客户端 UUID）/ DELETE 墓碑删除（幂等 204）。
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { designs } from '@/../db/schema';
import { getVerifiedSessionUserId } from '@/lib/auth/session';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { enforceSyncWriteLimit } from '@/lib/auth/rateLimit';
import { apiError, noContent, okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { designPutSchema, revisionDeleteSchema } from '@/lib/schemas';
import { exceedsProjectLimit } from '@/lib/sync/limits';
import { LIMITS } from '@/lib/appInfo';
import { AppError } from '@/lib/errors';
import type { ProjectFile } from '@/lib/types';
import { measureJsonBytes } from '@/lib/sync/revision';
import { assertDesignQuota, lockDesignStorage } from '@/lib/sync/designQuota';

const idSchema = z.string().uuid('设计 id 必须为 UUID');

function toProject(value: unknown): ProjectFile | null {
  return value && typeof value === 'object' ? (value as ProjectFile) : null;
}

function withCommunityOrigin(project: ProjectFile | null, fromCommunity: boolean): ProjectFile | null {
  if (!project) return null;
  if (fromCommunity) return { ...project, communityOrigin: true };
  const { communityOrigin: _ignored, ...regularProject } = project;
  return regularProject;
}

async function get(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getVerifiedSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return apiError(new AppError('NOT_FOUND', '设计不存在'));
  const db = getDb();
  const rows = await db
    .select({ id: designs.id, name: designs.name, project: designs.project, communitySourceWorkId: designs.communitySourceWorkId, updatedAt: designs.updatedAt, revision: designs.revision })
    .from(designs)
    .where(and(eq(designs.userId, userId), eq(designs.id, id), isNull(designs.deletedAt)));
  if (rows.length === 0) return apiError(new AppError('NOT_FOUND', '设计不存在'));
  const row = rows[0];
  return okJson({
    id: row.id,
    name: row.name,
    project: withCommunityOrigin(toProject(row.project), row.communitySourceWorkId !== null),
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
  if (!idSchema.safeParse(id).success) return apiError(new AppError('VALIDATION', '设计 id 必须为 UUID'));

  const parsed = await readJson(request, LIMITS.projectFileBytes + 64 * 1024);
  if (!parsed.ok) return parsed.response;
  const result = designPutSchema.safeParse(parsed.data);
  if (!result.success) return apiError(result.error);
  const { name, project: requestedProject, baseRevision } = result.data;
  if (exceedsProjectLimit(requestedProject)) {
    return apiError(new AppError('VALIDATION', '项目文件超过 5 MB 上限'));
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    await lockDesignStorage(tx, userId);
    await enforceSyncWriteLimit(tx, userId);
    const updatedAt = new Date();
    const requestedWithMetadata: ProjectFile = { ...requestedProject, name, updatedAt: updatedAt.toISOString() };
    const existing = await tx.select().from(designs).where(and(eq(designs.userId, userId), eq(designs.id, id)));
    const owned = existing[0];
    if (owned) {
      const project = withCommunityOrigin(requestedWithMetadata, owned.communitySourceWorkId !== null)!;
      const payloadBytes = measureJsonBytes(project);
      if (owned.revision !== baseRevision) return apiError(new AppError('REVISION_CONFLICT', '云端版本已更新'));
      await assertDesignQuota(tx, userId, payloadBytes, owned);
      const revision = baseRevision + 1;
      await tx.update(designs).set({ name, project, payloadBytes, updatedAt, deletedAt: null, revision }).where(and(eq(designs.userId, userId), eq(designs.id, id), eq(designs.revision, baseRevision)));
      return okJson({ id, name, width: project.pattern.width, height: project.pattern.height, updatedAt: updatedAt.toISOString(), revision });
    }
    if (baseRevision !== 0) return apiError(new AppError('REVISION_CONFLICT', '云端版本已更新'));
    const project = withCommunityOrigin(requestedWithMetadata, false)!;
    const payloadBytes = measureJsonBytes(project);
    const occupied = await tx.select({ userId: designs.userId }).from(designs).where(eq(designs.id, id));
    if (occupied.length > 0) return apiError(new AppError('CONFLICT', '该设计 id 已被占用，请重新保存'));
    await assertDesignQuota(tx, userId, payloadBytes);
    const inserted = await tx.insert(designs).values({ id, userId, name, project, payloadBytes, updatedAt, deletedAt: null, revision: 1 }).onConflictDoNothing().returning();
    if (inserted.length === 0) return apiError(new AppError('CONFLICT', '该设计 id 已被占用，请重新保存'));
    return okJson({ id, name, width: project.pattern.width, height: project.pattern.height, updatedAt: updatedAt.toISOString(), revision: 1 });
  });
}

async function del(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const userId = await getVerifiedSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return noContent(); // 幂等：非法 id 同样 204
  const parsed = await readJson(request, 1024);
  if (!parsed.ok) return parsed.response;
  const result = revisionDeleteSchema.safeParse(parsed.data);
  if (!result.success) return apiError(result.error);
  const { baseRevision } = result.data;
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockDesignStorage(tx, userId);
    await enforceSyncWriteLimit(tx, userId);
    const rows = await tx.select({ revision: designs.revision, deletedAt: designs.deletedAt, updatedAt: designs.updatedAt }).from(designs).where(and(eq(designs.userId, userId), eq(designs.id, id)));
    if (rows.length === 0) return okJson({ revision: baseRevision, updatedAt: new Date().toISOString() });
    if (rows[0].deletedAt && rows[0].revision === baseRevision + 1) return okJson({ revision: rows[0].revision, updatedAt: rows[0].updatedAt.toISOString() });
    if (rows[0].revision !== baseRevision) return apiError(new AppError('REVISION_CONFLICT', '云端版本已更新'));
    const deletedAt = new Date();
    const revision = baseRevision + 1;
    await tx.update(designs).set({ name: '', project: null, payloadBytes: 0, deletedAt, updatedAt: deletedAt, revision }).where(and(eq(designs.userId, userId), eq(designs.id, id), eq(designs.revision, baseRevision)));
    return okJson({ revision, updatedAt: deletedAt.toISOString() });
  });
}

export const GET = withApiErrors(get);
export const PUT = withApiErrors(put);
export const DELETE = withApiErrors(del);
