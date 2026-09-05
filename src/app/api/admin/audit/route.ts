import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { listAdminAudit } from '@/lib/admin/queries';

async function get(request: Request) {
  await requireApiActor('audit:read');
  const search = new URL(request.url).searchParams;
  const input = Object.fromEntries(['q', 'from', 'to', 'cursor'].flatMap((key) => search.get(key) ? [[key, search.get(key)]] : []));
  return okJson(await listAdminAudit(getDb(), input), { headers: { 'Cache-Control': 'private, no-store' } });
}
export const GET = withApiErrors(get);
