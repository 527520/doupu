import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { setCommunityLike } from '@/lib/community/interactions';

async function mutate(request: Request, context: { params: Promise<{ id: string }> }, liked: boolean) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
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
export const DELETE = withApiErrors(remove);
