import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { communityTags } from '@/../db/schema';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { createCommunityTag } from '@/lib/community/adminService';
import { executeIdempotently } from '@/lib/idempotency';

const schema = z.object({ name: z.string(), slug: z.string(), sortOrder: z.number().int().optional(), reason: z.string() }).strict();

async function get() {
  await requireApiActor('community:moderate');
  const items = await getDb().select().from(communityTags).orderBy(asc(communityTags.sortOrder), asc(communityTags.name));
  return okJson({ items }, { headers: { 'Cache-Control': 'private, no-store' } });
}

async function post(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:moderate');
  const body = await readJson(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const result = await executeIdempotently(getDb(), {
    actorUserId: actor.userId, capability: 'community:moderate', scope: 'admin.community.tag.create',
    key: request.headers.get('idempotency-key') ?? '', request: input,
  }, (tx) => createCommunityTag(tx, { actor, requestId, ...input }));
  return okJson(result.value, { status: result.replayed ? 200 : 201 });
}

export const GET = withApiErrors(get);
export const POST = withApiErrors(post);
