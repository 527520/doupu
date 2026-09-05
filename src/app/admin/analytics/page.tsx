import { forbidden } from 'next/navigation';
import { getDb } from '@/lib/auth/db';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import {
  analyticsDimensionSchema,
  analyticsQuerySchema,
  funnelIdSchema,
  queryAnalyticsDimensions,
  queryAnalyticsFunnel,
  queryAnalyticsSummary,
  queryAnalyticsTrend,
  type AnalyticsQuery,
} from '@/lib/analytics/reports';
import { analyticsRangeCapability, toShanghaiDay } from '@/lib/analytics/time';
import { zhCN } from '@/messages/zh-CN';

const DAY_MS = 24 * 60 * 60 * 1000;
type SearchParams = Record<string, string | string[] | undefined>;

function value(params: SearchParams, key: string): string | undefined {
  const raw = params[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function defaultQuery(now: Date): AnalyticsQuery {
  return { start: toShanghaiDay(new Date(now.getTime() - 29 * DAY_MS)), end: toShanghaiDay(now) };
}

function TrendChart({ points }: { points: Array<{ day: string; events: number; uniqueVisitors: number | null }> }) {
  const t = zhCN.communityAdmin.analyticsDashboard;
  if (points.length === 0) return <div className="admin-empty">{t.empty}</div>;
  const max = Math.max(...points.map((point) => point.events), 1);
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? 320 : 28 + (index * 584) / (points.length - 1),
    y: 176 - (point.events / max) * 140,
  }));
  return <>
    <figure className="analytics-chart">
      <figcaption>{t.chartCaption(max.toLocaleString('zh-CN'))}</figcaption>
      <svg viewBox="0 0 640 200" role="img" aria-label={t.chartLabel}>
        <path d={`M ${coordinates.map((point) => `${point.x} ${point.y}`).join(' L ')}`} fill="none" stroke="currentColor" strokeWidth="3" />
        {coordinates.map((point) => <circle key={point.day} cx={point.x} cy={point.y} r="5" tabIndex={0}><title>{t.chartPoint(point.day, point.events)}</title></circle>)}
      </svg>
    </figure>
    {points.some((point) => point.uniqueVisitors === null) && <p className="notice">{t.legacyDailyUvUnavailable}</p>}
    <div className="admin-table-scroll"><table><caption className="sr-only">{t.trendTable}</caption><thead><tr><th>{t.day}</th><th>{t.events}</th><th>{t.visitors}</th></tr></thead><tbody>{points.map((point) => <tr key={point.day}><td>{point.day}</td><td>{point.events}</td><td>{point.uniqueVisitors ?? t.emptyValue}</td></tr>)}</tbody></table></div>
  </>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getSessionActor();
  if (!authorize(actor, 'analytics:read')) forbidden();
  const now = new Date();
  const params = await searchParams;
  const fallback = defaultQuery(now);
  const candidate = analyticsQuerySchema.safeParse({
    start: value(params, 'start') ?? fallback.start,
    end: value(params, 'end') ?? fallback.end,
    eventName: value(params, 'eventName'), device: value(params, 'device'), browser: value(params, 'browser'),
    os: value(params, 'os'), actor: value(params, 'actor'), path: value(params, 'path'), referrer: value(params, 'referrer'),
    utmSource: value(params, 'utmSource'), utmMedium: value(params, 'utmMedium'),
    utmCampaign: value(params, 'utmCampaign'), utmContent: value(params, 'utmContent'),
  });
  let requested = candidate.success ? candidate.data : fallback;
  try {
    const capability = analyticsRangeCapability(requested.start, requested.end, now);
    const oldest = new Date(now);
    oldest.setUTCFullYear(oldest.getUTCFullYear() - 2);
    if (capability.start < oldest || capability.end > new Date(now.getTime() + 36 * 60 * 60 * 1000)) requested = fallback;
  } catch {
    requested = fallback;
  }
  const requestedCapability = analyticsRangeCapability(requested.start, requested.end, now);
  const filterKeys = ['device', 'browser', 'os', 'actor', 'path', 'referrer', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent'] as const;
  const filtersIgnored = requestedCapability.mode === 'aggregate' && filterKeys.some((key) => requested[key] !== undefined);
  const query: AnalyticsQuery = requestedCapability.mode === 'aggregate'
    ? { start: requested.start, end: requested.end, ...(requested.eventName ? { eventName: requested.eventName } : {}) }
    : requested;
  const dimension = analyticsDimensionSchema.catch('device').parse(value(params, 'dimension'));
  const funnel = funnelIdSchema.catch('creation').parse(value(params, 'funnel'));
  const db = getDb();
  const [summary, trend, breakdown, funnelResult] = await Promise.all([
    queryAnalyticsSummary(db, query, now), queryAnalyticsTrend(db, query, now),
    queryAnalyticsDimensions(db, query, dimension, now), queryAnalyticsFunnel(db, query, funnel, now),
  ]);
  const t = zhCN.communityAdmin.analyticsDashboard;
  const dimensions = Object.entries(t.dimensions);
  const funnelNames = Object.entries(t.funnelNames);
  const select = (name: string, label: string, options: Record<string, string>) => <label>{label}<select name={name} defaultValue={value(params, name) ?? ''}><option value="">{t.all}</option>{Object.entries(options).map(([key, option]) => <option key={key} value={key}>{option}</option>)}</select></label>;
  return <main id="main" className="admin-page">
    <header className="admin-page-header"><div><span>{t.eyebrow}</span><h1>{t.title}</h1></div><p>{t.description}</p></header>
    <form className="admin-panel admin-analytics-filters" method="get">
      <label>{t.start}<input type="date" name="start" defaultValue={requested.start} /></label><label>{t.end}<input type="date" name="end" defaultValue={requested.end} /></label>
      <label>{t.eventName}<input name="eventName" defaultValue={value(params, 'eventName') ?? ''} /></label>
      {select('device', t.device, t.devices)}{select('browser', t.browser, t.browsers)}{select('os', t.os, t.systems)}{select('actor', t.actor, t.actors)}
      <label>{t.path}<input name="path" defaultValue={value(params, 'path') ?? ''} /></label><label>{t.referrer}<input name="referrer" defaultValue={value(params, 'referrer') ?? ''} /></label>
      <label>{t.utmSource}<input name="utmSource" defaultValue={value(params, 'utmSource') ?? ''} /></label><label>{t.utmMedium}<input name="utmMedium" defaultValue={value(params, 'utmMedium') ?? ''} /></label><label>{t.utmCampaign}<input name="utmCampaign" defaultValue={value(params, 'utmCampaign') ?? ''} /></label><label>{t.utmContent}<input name="utmContent" defaultValue={value(params, 'utmContent') ?? ''} /></label>
      <label>{t.dimension}<select name="dimension" defaultValue={dimension}>{dimensions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>{t.funnel}<select name="funnel" defaultValue={funnel}>{funnelNames.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button className="btn-primary" type="submit">{t.apply}</button>
    </form>
    <p className="notice">{summary.capability.mode === 'exact' ? t.exactMode : t.aggregateMode}</p>
    {filtersIgnored && <p className="notice notice-warning">{t.ignoredFilters}</p>}
    <section className="admin-metrics" aria-label={t.summary}>
      <article><small>{t.eventsCode}</small><strong>{summary.totals.events.toLocaleString('zh-CN')}</strong><span>{t.events}</span></article>
      <article><small>{t.visitorsCode}</small><strong>{summary.totals.uniqueVisitors?.toLocaleString('zh-CN') ?? t.emptyValue}</strong><span>{t.rangeUv}</span></article>
      <article><small>{t.sessionsCode}</small><strong>{summary.totals.sessions?.toLocaleString('zh-CN') ?? t.emptyValue}</strong><span>{t.sessions}</span></article>
    </section>
    <section className="admin-proof-grid">
      <article className="admin-panel"><header><h2>{t.trend}</h2><span>{query.start} — {query.end}</span></header><TrendChart points={trend.points.map((point) => ({ day: point.day, events: point.events, uniqueVisitors: point.uniqueVisitors }))} /></article>
      <article className="admin-panel"><header><h2>{t.deviceBreakdown}</h2><span>{t.singleDimensionUv}</span></header>{breakdown.values.length === 0 ? <div className="admin-empty">{t.noDimension}</div> : <table><caption className="sr-only">{t.dimensionCaption}</caption><thead><tr><th>{t.value}</th><th>{t.events}</th><th>{t.visitors}</th></tr></thead><tbody>{breakdown.values.map((row) => <tr key={row.value}><td>{row.value}</td><td>{row.events}</td><td>{row.uniqueVisitors ?? t.emptyValue}</td></tr>)}</tbody></table>}</article>
      <article className="admin-panel"><header><h2>{t.funnelTitle}</h2><span>{t.funnelNames[funnel]}</span></header>{funnelResult.steps ? <table><thead><tr><th>{t.step}</th><th>{t.reachedSessions}</th><th>{t.conversion}</th></tr></thead><tbody>{funnelResult.steps.map((step) => <tr key={step.name}><td>{t.steps[step.name as keyof typeof t.steps]}</td><td>{step.sessions}</td><td>{step.conversionFromPrevious === null ? t.emptyValue : `${Math.round(step.conversionFromPrevious * 100)}%`}</td></tr>)}</tbody></table> : <p className="admin-empty">{funnelResult.unavailableReason}</p>}</article>
    </section>
    <p className="admin-footnote">{t.footnote}</p>
  </main>;
}
