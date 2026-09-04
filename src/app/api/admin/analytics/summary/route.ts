import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { analyticsQueryFromUrl } from '@/lib/analytics/http';
import { queryAnalyticsSummary } from '@/lib/analytics/reports';

async function get(request: Request) {
  await requireApiActor('analytics:read');
  const result = await queryAnalyticsSummary(getDb(), analyticsQueryFromUrl(request.url));
  return okJson(result, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiErrors(get);
