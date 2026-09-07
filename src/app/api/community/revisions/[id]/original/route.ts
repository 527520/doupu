import { z } from 'zod';
import { LIMITS } from '@/lib/appInfo';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceBinaryUploadGuard } from '@/lib/auth/guard';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { getSessionActor } from '@/lib/auth/session';
import { readRevisionOriginal, resolveOriginalAccess, storeRevisionOriginal } from '@/lib/community/originals';
import { getOriginalStore } from '@/lib/community/originalStore';
import { AppError } from '@/lib/errors';
import { enforceCommunityWriteLimit } from '@/lib/security/publicRateLimit';

const idSchema = z.uuid();

/**
 * 上传草稿修订的原图（D49）。请求体是图片字节本身；类型由服务端按魔数嗅探，
 * 不信任 Content-Type。上传与下载都经服务端代理：凭证只在服务端、CSP 不需放行第三方域名。
 */
async function put(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceBinaryUploadGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
  await enforceCommunityWriteLimit(getDb(), { userId: actor.userId, request });
  const revisionId = idSchema.parse((await params).id);
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > LIMITS.maxFileBytes) throw new AppError('PAYLOAD_TOO_LARGE', '原图超过 20 MB 上限');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) throw new AppError('VALIDATION', '原图为空', 'original');
  if (bytes.byteLength > LIMITS.maxFileBytes) throw new AppError('PAYLOAD_TOO_LARGE', '原图超过 20 MB 上限');
  const summary = await storeRevisionOriginal(getDb(), getOriginalStore(), { actor, revisionId, bytes });
  return okJson(summary, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}

/** 取回原图：仅作者、审核员/管理员、已成功引用者。响应绝不缓存。 */
async function get(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const revisionId = idSchema.parse((await params).id);
  const actor = await getSessionActor();
  const original = await readRevisionOriginal(getDb(), getOriginalStore(), actor, revisionId);
  return new Response(new Uint8Array(original.body), {
    status: 200,
    headers: {
      'content-type': original.contentType,
      'content-length': String(original.body.length),
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-original-access': original.access,
    },
  });
}

/** 是否可取回（不传字节）：工作台据此决定是否显示「从豆社取回原图」。 */
async function head(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const revisionId = idSchema.parse((await params).id);
  const actor = await getSessionActor();
  const resolved = await resolveOriginalAccess(getDb(), actor, revisionId);
  if (!resolved) return new Response(null, { status: 404, headers: { 'cache-control': 'private, no-store' } });
  return new Response(null, {
    status: 200,
    headers: {
      'content-type': resolved.row.mimeType,
      'content-length': String(resolved.row.byteSize),
      'cache-control': 'private, no-store',
      'x-original-access': resolved.access,
    },
  });
}

export const PUT = withApiErrors(put);
export const GET = withApiErrors(get);
export const HEAD = withApiErrors(head);
