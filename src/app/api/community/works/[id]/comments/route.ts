import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { createCommunityComment, listCommunityComments } from '@/lib/community/interactions';
import { getSessionActor } from '@/lib/auth/session';

const schema = z.object({ body: z.string() }).strict();

async function get(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const workId = z.string().uuid().parse((await params).id);
  const actor = await getSessionActor({ renew: true });
  return okJson({ items: await listCommunityComments(getDb(), workId, actor?.userId) });
}

async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
  const workId = z.string().uuid().parse((await params).id);
  const body = await readJson(request, 4 * 1024);
  if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const comment = await createCommunityComment(getDb(), { actor, workId, body: input.body });
  return okJson({ id: comment.id, status: comment.status, version: comment.version }, { status: 201 });
}

export const GET = withApiErrors(get);
export const POST = withApiErrors(post);
