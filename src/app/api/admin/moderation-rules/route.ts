import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { createModerationRuleSet } from '@/lib/community/interactions';
import { executeIdempotently } from '@/lib/idempotency';
import { z } from 'zod';
import { desc } from 'drizzle-orm';
import { moderationRuleSetVersions } from '@/../db/schema';

const schema = z.object({ rules: z.unknown(), reason: z.string() }).strict();

async function get() {
  await requireApiActor('moderation-rules:manage');
  const items = await getDb().select({
    id: moderationRuleSetVersions.id, version: moderationRuleSetVersions.version,
    rules: moderationRuleSetVersions.rules, active: moderationRuleSetVersions.active,
    reason: moderationRuleSetVersions.reason, createdAt: moderationRuleSetVersions.createdAt,
  }).from(moderationRuleSetVersions).orderBy(desc(moderationRuleSetVersions.version)).limit(50);
  return okJson({ items });
}

async function post(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('moderation-rules:manage');
  const body = await readJson(request, 64 * 1024);
  if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const result = await executeIdempotently(getDb(), {
    actorUserId: actor.userId, scope: 'admin.moderation-rules',
    key: request.headers.get('idempotency-key') ?? '', request: input,
  }, (tx) => createModerationRuleSet(tx, { actor, requestId, ...input }));
  return okJson({ id: result.value.id, version: result.value.version }, { status: result.replayed ? 200 : 201 });
}

export const POST = withApiErrors(post);
export const GET = withApiErrors(get);
