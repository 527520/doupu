import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { authorize } from '@/lib/auth/authorization';
import { withApiErrors } from '@/lib/auth/http';
import { getSessionActor } from '@/lib/auth/session';
import { getBoardProfile } from '@/lib/boardProfiles';
import { loadRevisionForThumbnail } from '@/lib/community/queries';
import { AppError } from '@/lib/errors';
import { renderPatternThumbnail, ThumbnailCache } from '@/lib/render/thumbnail';
import { enforcePublicReadLimit } from '@/lib/security/publicRateLimit';

const cache = new ThumbnailCache();

/**
 * 修订不可变（ADR-0015），同一修订的缩略图永不改变：
 * 公开修订允许长期缓存；作者本人和审核员可看到未公开修订，但不进入共享缓存。
 */
async function get(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const revisionId = z.uuid().parse((await params).id);
  const size = new URL(request.url).searchParams.get('size') === 'large' ? 'large' : 'default';
  const revision = await loadRevisionForThumbnail(getDb(), revisionId);
  if (!revision) throw new AppError('NOT_FOUND', '图纸不存在');
  let visible = revision.isPublic;
  if (!visible) {
    const actor = await getSessionActor();
    visible = Boolean(actor && (authorize(actor, 'community:moderate') || (revision.authorUserId !== null && actor.userId === revision.authorUserId)));
  }
  if (!visible) throw new AppError('NOT_FOUND', '图纸不存在');
  const cacheKey = `${revision.id}:${size}`;
  let png = cache.get(cacheKey);
  if (!png) {
    // 只有真正要渲染 PNG 时才计入节流：命中进程缓存的请求成本极低。
    await enforcePublicReadLimit(getDb(), request, 'thumbnail');
    png = renderPatternThumbnail(revision.pattern, { boardSize: getBoardProfile(revision.boardProfile).boardCols, size });
    cache.set(cacheKey, png);
  }
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-length': String(png.length),
      'cache-control': revision.isPublic ? 'public, max-age=31536000, immutable' : 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export const GET = withApiErrors(get);
