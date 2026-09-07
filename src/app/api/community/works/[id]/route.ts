import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { AppError } from '@/lib/errors';
import { getPublicCommunityWork } from '@/lib/community/queries';
import { getSessionActor } from '@/lib/auth/session';
import { enforcePublicReadLimit } from '@/lib/security/publicRateLimit';

/** 匿名访客拿不到完整图纸 JSON（ADR-0021）；登录后响应因人而异，不进共享缓存。 */
async function get(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) throw new AppError('NOT_FOUND', '作品不存在');
  await enforcePublicReadLimit(getDb(), request, 'work');
  const actor = await getSessionActor();
  const work = await getPublicCommunityWork(getDb(), id.data, { includeSnapshot: Boolean(actor) });
  if (!work) throw new AppError('NOT_FOUND', '作品不存在');
  return okJson(work, { headers: { 'Cache-Control': actor ? 'private, no-store' : 'public, s-maxage=60, stale-while-revalidate=300', Vary: 'Cookie' } });
}

export const GET = withApiErrors(get);
