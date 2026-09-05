import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { listManagedCommunityWorks } from '@/lib/community/adminQueries';

async function get(request: Request) {
  await requireApiActor('community:moderate');
  return okJson(await listManagedCommunityWorks(getDb(), Object.fromEntries(new URL(request.url).searchParams)), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
export const GET = withApiErrors(get);
