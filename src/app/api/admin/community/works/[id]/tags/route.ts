import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { okJson, readJson, withApiErrors } from '@/lib/auth/http';
import { setCommunityWorkTags } from '@/lib/community/adminService';
import { WORK_TAG_LIMIT } from '@/lib/community/tagNames';
import { executeIdempotently } from '@/lib/idempotency';

const schema = z.object({
  expectedVersion: z.number().int().positive(),
  tags: z.array(z.string().max(60)).max(WORK_TAG_LIMIT),
  reason: z.string().max(500).optional(),
}).strict();

/** 整体替换一件作品的标签（D51）：审核员在作品管理里的标签输入框保存时调用。 */
async function put(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const actor = await requireApiActor('community:moderate');
  const workId = z.uuid().parse((await params).id);
  const body = await readJson(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = schema.parse(body.data);
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const result = await executeIdempotently(getDb(), {
    actorUserId: actor.userId, capability: 'community:moderate', scope: `admin.community.work.tags:${workId}`,
    key: request.headers.get('idempotency-key') ?? '', request: input,
  }, (tx) => setCommunityWorkTags(tx, { actor, workId, requestId, ...input }));
  return okJson(result.value);
}

export const PUT = withApiErrors(put);
