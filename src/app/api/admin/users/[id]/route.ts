import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { updateUserGovernance } from '@/lib/admin/userGovernance';
import { executeIdempotently } from '@/lib/idempotency';

const schema = z.object({
  targetConfirmation: z.string().uuid(), expectedVersion: z.number().int().positive(),
  role: z.enum(['user', 'moderator', 'admin']).optional(),
  accountStatus: z.enum(['active', 'suspended']).optional(), reason: z.string(),
}).strict();

async function patch(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request); if (guard) return guard;
  const actor = await requireApiActor('users:manage');
  const targetUserId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 8 * 1024); if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const result = await executeIdempotently(getDb(), {
    actorUserId: actor.userId, scope: `admin.user:${targetUserId}`, governance: true, capability: 'users:manage',
    key: request.headers.get('idempotency-key') ?? '', request: input,
  }, (tx) => updateUserGovernance(tx, { actorUserId: actor.userId, targetUserId,
    requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(), ...input }));
  return okJson(result.value);
}
export const PATCH = withApiErrors(patch);
