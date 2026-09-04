import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { analyticsQueryFromUrl } from '@/lib/analytics/http';
import { funnelIdSchema, queryAnalyticsFunnel } from '@/lib/analytics/reports';

async function get(request: Request) {
  await requireApiActor('analytics:read');
  const url = new URL(request.url);
  const funnel = funnelIdSchema.parse(url.searchParams.get('funnel'));
  const result = await queryAnalyticsFunnel(getDb(), analyticsQueryFromUrl(request.url), funnel);
  return okJson(result, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiErrors(get);
