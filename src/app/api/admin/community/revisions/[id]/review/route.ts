import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { reviewCommunityRevision } from '@/lib/community/service';
import { executeIdempotently } from '@/lib/idempotency';

const schema = z.object({
  decision: z.enum(['published', 'rejected']),
  expectedVersion: z.number().int().positive(),
  reason: z.string(),
}).strict();

async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:moderate');
  const revisionId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const result = await executeIdempotently(getDb(), {
    actorUserId: actor.userId, scope: `admin.community.revision:${revisionId}`,
    key: request.headers.get('idempotency-key') ?? '', request: input,
  }, (tx) => reviewCommunityRevision(tx, { actor, revisionId, requestId, ...input }));
  const revision = result.value;
  return okJson({ revisionId: revision.id, status: revision.status, version: revision.version });
}

export const POST = withApiErrors(post);
