import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { submitCommunityRevision } from '@/lib/community/service';

async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
  const revisionId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 4 * 1024);
  if (!body.ok) return body.response;
  const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(body.data);
  const revision = await submitCommunityRevision(getDb(), { actor, revisionId, expectedVersion });
  return okJson({ revisionId: revision.id, status: revision.status, version: revision.version });
}

export const POST = withApiErrors(post);
