import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { listCommunityReviewQueue } from '@/lib/community/queries';

async function get() {
  await requireApiActor('community:moderate');
  return okJson({ items: await listCommunityReviewQueue(getDb()) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiErrors(get);
