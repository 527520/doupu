import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { createCommunityWork } from '@/lib/community/service';
import { listPublicCommunityWorks, parseCommunityListUrl } from '@/lib/community/queries';
import { executeIdempotently } from '@/lib/idempotency';
import type { AnyDatabase } from '@/../db/client';

const createSchema = z.object({
  designId: z.string().uuid(),
  expectedDesignRevision: z.number().int().positive().optional(),
  title: z.string(),
  licenseVersion: z.string(),
  tagIds: z.array(z.string().uuid()).max(10).optional(),
}).strict();

async function get(request: Request) {
  return okJson(await listPublicCommunityWorks(getDb(), parseCommunityListUrl(request.url)), {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}

async function post(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
  const body = await readJson(request, 32 * 1024);
  if (!body.ok) return body.response;
  const input = createSchema.parse(body.data);
  const create = async (db: AnyDatabase) => {
    const result = await createCommunityWork(db, { actor, ...input });
    return { workId: result.work.id, revisionId: result.revision.id, status: result.revision.status, version: result.revision.version };
  };
  const key = request.headers.get('idempotency-key');
  const result = key === null ? await create(getDb()) : (await executeIdempotently(getDb(), {
    actorUserId: actor.userId, scope: 'community:create', key, request: input, capability: 'community:interact',
  }, create)).value;
  return okJson(result, { status: 201 });
}

export const GET = withApiErrors(get);
export const POST = withApiErrors(post);
