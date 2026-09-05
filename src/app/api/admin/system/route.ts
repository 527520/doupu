import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { getSystemInfo } from '@/lib/admin/queries';

async function get() { await requireApiActor('system:read'); return okJson(await getSystemInfo(getDb()), { headers: { 'Cache-Control': 'private, no-store' } }); }
export const GET = withApiErrors(get);
