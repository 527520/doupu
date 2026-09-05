import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { reuseCommunityWork } from '@/lib/community/interactions';
import { executeIdempotently } from '@/lib/idempotency';

async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
  const workId = z.string().uuid().parse((await params).id);
  const result = await executeIdempotently(getDb(), {
    actorUserId: actor.userId, capability: 'community:interact', scope: `community.reuse:${workId}`,
    key: request.headers.get('idempotency-key') ?? '', request: { workId },
  }, (tx) => reuseCommunityWork(tx, { actor, workId }));
  return okJson(result.value, { status: result.replayed ? 200 : 201, headers: { 'Idempotency-Replayed': String(result.replayed) } });
}

export const POST = withApiErrors(post);
