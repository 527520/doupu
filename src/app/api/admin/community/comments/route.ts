import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { listGovernanceQueues } from '@/lib/community/interactions';

async function get() {
  await requireApiActor('community:moderate');
  const queues = await listGovernanceQueues(getDb());
  return okJson({ items: queues.comments });
}

export const GET = withApiErrors(get);
