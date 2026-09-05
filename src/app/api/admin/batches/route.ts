import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { createOfficialBatch, listOfficialBatches, officialBatchDefaultParamsSchema } from '@/lib/community/officialBatch';
import { executeIdempotently } from '@/lib/idempotency';

const schema = z.object({ itemCount: z.number().int().min(1).max(50), defaultParams: officialBatchDefaultParamsSchema, engineVersion: z.string(), reason: z.string() }).strict();
async function get() { const actor = await requireApiActor('official:manage'); return okJson({ items: await listOfficialBatches(getDb(), actor.userId) }); }
async function post(request: Request) {
  const guard = enforceMutatingGuard(request); if (guard) return guard;
  const actor = await requireApiActor('official:manage'); const body = await readJson(request, 64 * 1024); if (!body.ok) return body.response;
  const input = schema.parse(body.data); const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const result = await executeIdempotently(getDb(), { actorUserId: actor.userId, capability: 'official:manage', scope: 'admin.official-batch.create', key: request.headers.get('idempotency-key') ?? '', request: input },
    (tx) => createOfficialBatch(tx, { actor, requestId, ...input }));
  return okJson(result.value, { status: result.replayed ? 200 : 201 });
}
export const GET = withApiErrors(get); export const POST = withApiErrors(post);
