import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { listAdminAudit } from '@/lib/admin/queries';

async function get() { await requireApiActor('audit:read'); return okJson({ items: await listAdminAudit(getDb()) }); }
export const GET = withApiErrors(get);
