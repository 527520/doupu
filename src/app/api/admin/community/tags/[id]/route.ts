import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { updateCommunityTag } from '@/lib/community/adminService';
import { AppError } from '@/lib/errors';

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
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey || idempotencyKey.length > 100) throw new AppError('VALIDATION', '需要有效的 Idempotency-Key');
  const tagId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const tag = await updateCommunityTag(getDb(), {
    actor, tagId, requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(), ...input,
  });
  return okJson(tag);
}

export const PATCH = withApiErrors(patch);
