import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { deleteCommunityComment, editCommunityComment } from '@/lib/community/interactions';

const editSchema = z.object({ body: z.string(), expectedVersion: z.number().int().positive() }).strict();
const deleteSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

async function patch(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
  const commentId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 4 * 1024);
  if (!body.ok) return body.response;
  const input = editSchema.parse(body.data);
  const comment = await editCommunityComment(getDb(), { actor, commentId, ...input });
  return okJson({ id: comment.id, status: comment.status, version: comment.version });
}

async function remove(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
  const commentId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 1024);
  if (!body.ok) return body.response;
  const input = deleteSchema.parse(body.data);
  const comment = await deleteCommunityComment(getDb(), { actor, commentId, ...input });
  return okJson({ id: comment.id, status: comment.status, version: comment.version });
}

export const PATCH = withApiErrors(patch);
export const DELETE = withApiErrors(remove);
