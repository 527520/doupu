import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { authorize } from '@/lib/auth/authorization';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { getAdminOverview } from '@/lib/admin/overview';

/** 后台导航角标与总览页共用的待办计数；审核员看不到系统健康。 */
async function get() {
  const actor = await requireApiActor('community:moderate');
  return okJson(await getAdminOverview(getDb(), { includeSystem: authorize(actor, 'system:read') }), { headers: { 'Cache-Control': 'private, no-store' } });
}
export const GET = withApiErrors(get);
