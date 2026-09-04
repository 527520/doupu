import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { publishOfficialBatch } from '@/lib/community/officialBatch';
import { executeIdempotently } from '@/lib/idempotency';
const schema = z.object({ revisionIds: z.array(z.string().uuid()).min(1).max(50), expectedVersion: z.number().int().positive(), reason: z.string() }).strict();
async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request); if (guard) return guard; const actor = await requireApiActor('official:manage'); const batchId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 16 * 1024); if (!body.ok) return body.response; const input = schema.parse(body.data); const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const result = await executeIdempotently(getDb(), { actorUserId: actor.userId, scope: `admin.official-batch.publish:${batchId}`, key: request.headers.get('idempotency-key') ?? '', request: input },
    (tx) => publishOfficialBatch(tx, { actor, batchId, requestId, ...input })); return okJson(result.value);
}
export const POST = withApiErrors(post);
