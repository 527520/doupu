import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { createCommunityRevision } from '@/lib/community/service';
import { executeIdempotently } from '@/lib/idempotency';
import type { AnyDatabase } from '@/../db/client';

const bodySchema = z.object({
  designId: z.string().uuid(),
  expectedDesignRevision: z.number().int().positive().optional(),
  title: z.string(),
  licenseVersion: z.string(),
  tagIds: z.array(z.string().uuid()).max(10).optional(),
}).strict();

async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
  const workId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 32 * 1024);
  if (!body.ok) return body.response;
  const input = bodySchema.parse(body.data);
  const create = async (db: AnyDatabase) => {
    const revision = await createCommunityRevision(db, { actor, workId, ...input });
    return { revisionId: revision.id, status: revision.status, version: revision.version };
  };
  const key = request.headers.get('idempotency-key');
  const result = key === null ? await create(getDb()) : (await executeIdempotently(getDb(), {
    actorUserId: actor.userId, scope: `community:revision:${workId}`, key, request: input, capability: 'community:interact',
  }, create)).value;
  return okJson(result, { status: 201 });
}

export const POST = withApiErrors(post);
