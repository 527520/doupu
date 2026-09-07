import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { getCommunityLike, setCommunityLike } from '@/lib/community/interactions';
import { getSessionActor } from '@/lib/auth/session';
import { enforceCommunityWriteLimit } from '@/lib/security/publicRateLimit';

async function get(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const workId = z.string().uuid().parse((await params).id);
  const actor = await getSessionActor({ renew: true });
  return okJson(await getCommunityLike(getDb(), { workId, userId: actor?.userId }), {
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
  });
}

async function mutate(request: Request, context: { params: Promise<{ id: string }> }, liked: boolean) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
  await enforceCommunityWriteLimit(getDb(), { userId: actor.userId, request });
  const workId = z.string().uuid().parse((await context.params).id);
  return okJson(await setCommunityLike(getDb(), { actor, workId, liked }));
}

async function put(request: Request, context: { params: Promise<{ id: string }> }) {
  return mutate(request, context, true);
}

async function remove(request: Request, context: { params: Promise<{ id: string }> }) {
  return mutate(request, context, false);
}

export const PUT = withApiErrors(put);
export const GET = withApiErrors(get);
export const DELETE = withApiErrors(remove);
