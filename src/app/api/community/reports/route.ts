import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { reportCategorySchema, reportCommunityTarget } from '@/lib/community/interactions';

const schema = z.object({
  targetType: z.enum(['work', 'comment']), targetId: z.string().uuid(),
  category: reportCategorySchema, details: z.string().max(500).optional(),
}).strict();

async function post(request: Request) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:interact');
  const body = await readJson(request, 4 * 1024);
  if (!body.ok) return body.response;
  const report = await reportCommunityTarget(getDb(), { actor, ...schema.parse(body.data) });
  return okJson({ id: report.id, status: report.status, version: report.version }, { status: 201 });
}

export const POST = withApiErrors(post);
