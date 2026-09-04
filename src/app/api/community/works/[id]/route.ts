import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { AppError } from '@/lib/errors';
import { getPublicCommunityWork } from '@/lib/community/queries';

async function get(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) throw new AppError('NOT_FOUND', '作品不存在');
  const work = await getPublicCommunityWork(getDb(), id.data);
  if (!work) throw new AppError('NOT_FOUND', '作品不存在');
  return okJson(work, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
}

export const GET = withApiErrors(get);
