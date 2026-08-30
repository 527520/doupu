/**
 * POST /api/designs/[id]/share：创建/替换只读分享链接（批次 K，决策 D38）。
 * DELETE：撤销分享。
 *
 * 与 D13 一致：分享的是图纸快照（项目文件 JSON），不含原图、不含作者邮箱。
 * 快照在创建时固化——分享出去的链接不会因作者继续编辑而变样，作者删除设计后仍可访问，
 * 直到作者显式撤销。token 只存哈希，库泄露不等于链接泄露。
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { designs, designShares } from '@/../db/schema';
import { getVerifiedSessionUserId } from '@/lib/auth/session';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { enforceSyncWriteLimit } from '@/lib/auth/rateLimit';
import { apiError, noContent, okJson, withApiErrors } from '@/lib/auth/http';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { AppError } from '@/lib/errors';
import { shareSnapshotFromProject } from '@/lib/share/snapshot';

const idSchema = z.string().uuid('设计 id 必须为 UUID');

async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const userId = await getVerifiedSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return apiError(new AppError('VALIDATION', '设计 id 必须为 UUID'));

  const db = getDb();
  await enforceSyncWriteLimit(db, userId);

  const rows = await db
    .select({ name: designs.name, project: designs.project })
    .from(designs)
    .where(and(eq(designs.userId, userId), eq(designs.id, id), isNull(designs.deletedAt)));
  if (rows.length === 0) return apiError(new AppError('NOT_FOUND', '设计不存在'));

  const snapshot = shareSnapshotFromProject(rows[0].project);
  if (!snapshot) return apiError(new AppError('VALIDATION', '这个设计还没有可分享的图纸'));

  const token = generateToken();
  const tokenHash = hashToken(token);
  // 一个设计同时只保留一条有效分享：重新分享会作废旧链接（用户预期「换个链接」）。
  // 删除旧链接和创建新链接必须原子完成；否则新 token 冲突或数据库故障会把仍可用的旧链接一并丢掉。
  await db.transaction(async (tx) => {
    await tx.delete(designShares).where(and(eq(designShares.userId, userId), eq(designShares.designId, id)));
    await tx.insert(designShares).values({
      designId: id,
      userId,
      tokenHash,
      snapshot,
      name: rows[0].name,
    });
  });
  return okJson({ token, path: `/s/${token}` }, { status: 201 });
}

async function del(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const userId = await getVerifiedSessionUserId();
  if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return noContent(); // 幂等
  const db = getDb();
  await db.delete(designShares).where(and(eq(designShares.userId, userId), eq(designShares.designId, id)));
  return noContent();
}

export const POST = withApiErrors(post);
export const DELETE = withApiErrors(del);
