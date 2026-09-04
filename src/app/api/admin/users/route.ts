import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { listGovernedUsers } from '@/lib/admin/queries';

async function get(request: Request) {
  await requireApiActor('users:manage');
  return okJson({ items: await listGovernedUsers(getDb(), new URL(request.url).searchParams.get('q') ?? undefined) });
}
export const GET = withApiErrors(get);
