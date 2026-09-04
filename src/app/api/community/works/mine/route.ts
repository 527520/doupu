import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { listOwnCommunityWorks } from '@/lib/community/queries';

async function get() {
  const actor = await requireApiActor('community:interact');
  return okJson({ items: await listOwnCommunityWorks(getDb(), actor.userId) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiErrors(get);
