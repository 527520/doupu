import { asc, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { communityTags, communityWorkTags } from '@/../db/schema';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { createCommunityTag } from '@/lib/community/adminService';
import { executeIdempotently } from '@/lib/idempotency';

const schema = z.object({ name: z.string(), slug: z.string().optional(), sortOrder: z.number().int().optional(), reason: z.string(), expectedVersion: z.literal(0) }).strict();

async function get(request: Request) {
  await requireApiActor('community:moderate');
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  const db = getDb();
  const usage = sql<number>`(select count(*) from ${communityWorkTags} cwt where cwt.tag_id = ${communityTags.id})::int`;
  const rows = await db.select({
    id: communityTags.id, name: communityTags.name, slug: communityTags.slug, sortOrder: communityTags.sortOrder,
    active: communityTags.active, mergedIntoTagId: communityTags.mergedIntoTagId, version: communityTags.version,
    createdAt: communityTags.createdAt, updatedAt: communityTags.updatedAt, workCount: usage,
  }).from(communityTags)
    .where(q ? ilike(communityTags.name, `%${q}%`) : undefined)
    .orderBy(asc(communityTags.sortOrder), asc(communityTags.name)).limit(q ? 20 : 500);
  return okJson({ items: rows.map((row) => ({ ...row, workCount: Number(row.workCount) })) }, { headers: { 'Cache-Control': 'private, no-store' } });
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
