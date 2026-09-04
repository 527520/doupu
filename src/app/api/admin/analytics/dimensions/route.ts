import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { analyticsQueryFromUrl } from '@/lib/analytics/http';
import { analyticsDimensionSchema, queryAnalyticsDimensions } from '@/lib/analytics/reports';

async function get(request: Request) {
  await requireApiActor('analytics:read');
  const url = new URL(request.url);
  const dimension = analyticsDimensionSchema.parse(url.searchParams.get('dimension'));
  const result = await queryAnalyticsDimensions(getDb(), analyticsQueryFromUrl(request.url), dimension);
  return okJson(result, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiErrors(get);
