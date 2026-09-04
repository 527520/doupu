import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { updateCommunityTag } from '@/lib/community/adminService';
import { executeIdempotently } from '@/lib/idempotency';

const schema = z.object({
  expectedVersion: z.number().int().positive(),
  name: z.string().optional(),
  slug: z.string().optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
  reason: z.string(),
}).strict();

async function patch(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:moderate');
  const tagId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const result = await executeIdempotently(getDb(), {
    actorUserId: actor.userId, scope: `admin.community.tag:${tagId}`,
    key: request.headers.get('idempotency-key') ?? '', request: input,
  }, (tx) => updateCommunityTag(tx, { actor, tagId, requestId, ...input }));
  return okJson(result.value);
}

export const PATCH = withApiErrors(patch);
