import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { moderateCommunityComment } from '@/lib/community/interactions';
import { executeIdempotently } from '@/lib/idempotency';

const schema = z.object({ decision: z.enum(['published', 'hidden']), expectedVersion: z.number().int().positive(), reason: z.string() }).strict();

async function patch(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:moderate');
  const commentId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const result = await executeIdempotently(getDb(), {
    actorUserId: actor.userId, scope: `admin.community.comment:${commentId}`,
    key: request.headers.get('idempotency-key') ?? '', request: input,
  }, (tx) => moderateCommunityComment(tx, { actor, commentId, requestId, ...input }));
  return okJson({ id: result.value.id, status: result.value.status, version: result.value.version });
}

export const PATCH = withApiErrors(patch);
