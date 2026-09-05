import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { withdrawCommunitySubmission } from '@/lib/community/service';
import { executeIdempotently } from '@/lib/idempotency';
import type { AnyDatabase } from '@/../db/client';

async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
  const revisionId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 4 * 1024);
  if (!body.ok) return body.response;
  const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(body.data);
  const withdraw = async (db: AnyDatabase) => {
    const revision = await withdrawCommunitySubmission(db, { actor, revisionId, expectedVersion });
    return { revisionId: revision.id, status: revision.status, version: revision.version };
  };
  const key = request.headers.get('idempotency-key');
  const result = key === null ? await withdraw(getDb()) : (await executeIdempotently(getDb(), {
    actorUserId: actor.userId, scope: `community:withdraw-revision:${revisionId}`, key,
    request: { expectedVersion }, capability: 'community:interact',
  }, withdraw)).value;
  return okJson(result);
}

export const POST = withApiErrors(post);
