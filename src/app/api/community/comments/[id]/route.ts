import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { deleteCommunityComment } from '@/lib/community/interactions';

// 评论只能发表与删除：编辑能力已在 site-ui-overhaul 05 移除（ADR-0022）。
const deleteSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

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

export const DELETE = withApiErrors(remove);
