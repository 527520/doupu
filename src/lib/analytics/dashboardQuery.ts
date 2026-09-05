import { analyticsDimensionSchema, analyticsQuerySchema, funnelIdSchema, type AnalyticsQuery } from './reports';
import { analyticsRangeCapability, oldestAnalyticsRollupDay, toShanghaiDay } from './time';

export type DashboardSearchParams = Record<string, string | string[] | undefined>;
export const DASHBOARD_COMBINATION_FILTERS = ['device', 'browser', 'os', 'actor', 'path', 'referrer', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent'] as const;

export function resolveDashboardQuery(params: DashboardSearchParams, now: Date) {
  const fallback: AnalyticsQuery = { start: toShanghaiDay(new Date(now.getTime() - 29 * 86400000)), end: toShanghaiDay(now) };
  const input: Record<string, unknown> = {};
  for (const key of ['start', 'end', 'eventName', ...DASHBOARD_COMBINATION_FILTERS]) {
    const raw = params[key];
    if (Array.isArray(raw)) input[key] = raw;
    else if (raw?.trim()) input[key] = raw.trim();
  }
  const candidate = analyticsQuerySchema.safeParse({ start: fallback.start, end: fallback.end, ...input });
  let invalid = !candidate.success;
  let requested = candidate.success ? candidate.data : fallback;
  try {
    const capability = analyticsRangeCapability(requested.start, requested.end, now);
    if (requested.start < oldestAnalyticsRollupDay(now) || capability.end > new Date(now.getTime() + 36 * 3600000)) { requested = fallback; invalid = true; }
  } catch { requested = fallback; invalid = true; }
  const mode = analyticsRangeCapability(requested.start, requested.end, now).mode;
  const filtersIgnored = mode === 'aggregate' && DASHBOARD_COMBINATION_FILTERS.some((key) => requested[key] !== undefined);
  const query: AnalyticsQuery = mode === 'aggregate'
    ? { start: requested.start, end: requested.end, ...(requested.eventName ? { eventName: requested.eventName } : {}) }
    : requested;
  const dimension = analyticsDimensionSchema.safeParse(params.dimension ?? 'device');
  const funnel = funnelIdSchema.safeParse(params.funnel ?? 'creation');
  return { query, requested, filtersIgnored, invalid: invalid || !dimension.success || !funnel.success,
    dimension: dimension.success ? dimension.data : 'device' as const, funnel: funnel.success ? funnel.data : 'creation' as const };
}
