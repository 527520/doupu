import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { addTagsToCommunityWorks } from '@/lib/community/adminService';
import { WORK_TAG_LIMIT } from '@/lib/community/tagNames';
import { executeIdempotently } from '@/lib/idempotency';

const schema = z.object({
  workIds: z.array(z.uuid()).min(1).max(50),
  tags: z.array(z.string().max(60)).min(1).max(WORK_TAG_LIMIT),
  reason: z.string().max(500).optional(),
}).strict();

/** 批量打标：给作品列表里勾选的多件作品追加同一组标签。 */
async function post(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:moderate');
  const body = await readJson(request, 16 * 1024);
  if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const result = await executeIdempotently(getDb(), {
    actorUserId: actor.userId, capability: 'community:moderate', scope: 'admin.community.work.tags.batch',
    key: request.headers.get('idempotency-key') ?? '', request: input,
  }, (tx) => addTagsToCommunityWorks(tx, { actor, requestId, ...input }));
  return okJson(result.value);
}

export const POST = withApiErrors(post);
