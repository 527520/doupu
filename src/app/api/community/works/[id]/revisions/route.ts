import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { createCommunityRevision } from '@/lib/community/service';

const bodySchema = z.object({
  designId: z.string().uuid(),
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
  const revision = await createCommunityRevision(getDb(), { actor, workId, ...input });
  return okJson({ revisionId: revision.id, status: revision.status, version: revision.version }, { status: 201 });
}

export const POST = withApiErrors(post);
