import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { moderateCommunityWork } from '@/lib/community/adminService';
import { AppError } from '@/lib/errors';

const schema = z.object({
  action: z.enum(['remove', 'restore', 'feature', 'unfeature', 'lock_comments', 'unlock_comments']),
  expectedVersion: z.number().int().positive(),
  reason: z.string(),
}).strict();

async function patch(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:moderate');
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey || idempotencyKey.length > 100) throw new AppError('VALIDATION', '需要有效的 Idempotency-Key');
  const workId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const work = await moderateCommunityWork(getDb(), {
    actor, workId, requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(), ...input,
  });
  return okJson({ workId: work.id, lifecycleStatus: work.lifecycleStatus, commentsLocked: work.commentsLocked, featured: Boolean(work.featuredAt), version: work.version });
}

export const PATCH = withApiErrors(patch);
