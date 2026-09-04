import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { moderateCommunityWork } from '@/lib/community/adminService';
import { executeIdempotently } from '@/lib/idempotency';

const schema = z.object({
  action: z.enum(['remove', 'restore', 'feature', 'unfeature', 'lock_comments', 'unlock_comments']),
  expectedVersion: z.number().int().positive(),
  reason: z.string(),
}).strict();

async function patch(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:moderate');
  const workId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const result = await executeIdempotently(getDb(), {
    actorUserId: actor.userId, scope: `admin.community.work:${workId}`,
    key: request.headers.get('idempotency-key') ?? '', request: input,
  }, (tx) => moderateCommunityWork(tx, { actor, workId, requestId, ...input }));
  const work = result.value;
  return okJson({ workId: work.id, lifecycleStatus: work.lifecycleStatus, commentsLocked: work.commentsLocked, featured: Boolean(work.featuredAt), version: work.version });
}

export const PATCH = withApiErrors(patch);
