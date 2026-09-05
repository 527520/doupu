import { forbidden } from 'next/navigation';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import Link from 'next/link';
import { getDb } from '@/lib/auth/db';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import {
  queryAnalyticsDimensions,
  queryAnalyticsFunnel,
  queryAnalyticsSummary,
  queryAnalyticsTrend,
} from '@/lib/analytics/reports';
import { DASHBOARD_COMBINATION_FILTERS, resolveDashboardQuery, type DashboardSearchParams } from '@/lib/analytics/dashboardQuery';
import { zhCN } from '@/messages/zh-CN';

import TrendChart from '@/components/admin/AnalyticsTrendChart';
import DailyDimensionTrend from '@/components/admin/DailyDimensionTrend';
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const actor = await getSessionActor();
  if (!authorize(actor, 'analytics:read')) forbidden();
  const now = new Date();
  const params = await searchParams;
  const { requested, query, dimension, funnel, invalid, filtersIgnored } = resolveDashboardQuery(params, now);
  const db = getDb();
  const [summary, trend, breakdown, funnelResult] = await Promise.all([
    queryAnalyticsSummary(db, query, now), queryAnalyticsTrend(db, query, now),
    queryAnalyticsDimensions(db, query, dimension, now), queryAnalyticsFunnel(db, query, funnel, now),
  ]);
  const t = zhCN.communityAdmin.analyticsDashboard;
  const dimensions = Object.entries(t.dimensions);
  const funnelNames = Object.entries(t.funnelNames);
  const select = (name: typeof DASHBOARD_COMBINATION_FILTERS[number], label: string, options: Record<string, string>) => <ResponsiveSelect label={label} name={name} defaultValue={requested[name]??''} options={[{value:'',label:t.all},...Object.entries(options).map(([value,label])=>({value,label}))]} />;
  return <main id="main" className="admin-page">
    <header className="admin-page-header"><div><span>{t.eyebrow}</span><h1>{t.title}</h1></div><p>{t.description}</p></header>
    {invalid && <p role="alert" className="notice notice-warning">{t.invalidQuery}</p>}
    <form className="admin-panel admin-analytics-form" method="get">
      <div className="admin-analytics-filters">
        <label>{t.start}<input type="date" name="start" defaultValue={requested.start} /></label><label>{t.end}<input type="date" name="end" defaultValue={requested.end} /></label>
        <label>{t.eventName}<input name="eventName" maxLength={80} defaultValue={requested.eventName ?? ''} placeholder={t.eventExample} /></label>
        <ResponsiveSelect label={t.dimension} name="dimension" defaultValue={dimension} options={dimensions.map(([value,label])=>({value,label}))} />
        <ResponsiveSelect label={t.funnel} name="funnel" defaultValue={funnel} options={funnelNames.map(([value,label])=>({value,label}))} />
      </div>
      <details className="admin-advanced-filters" open={DASHBOARD_COMBINATION_FILTERS.some((key) => requested[key] !== undefined)}><summary>{t.advanced}</summary><p>{t.advancedHint}</p><div className="admin-analytics-filters">
        {select('device', t.device, t.devices)}{select('browser', t.browser, t.browsers)}{select('os', t.os, t.systems)}{select('actor', t.actor, t.actors)}
        <label>{t.path}<input name="path" maxLength={200} defaultValue={requested.path ?? ''} /></label><label>{t.referrer}<input name="referrer" maxLength={253} defaultValue={requested.referrer ?? ''} /></label>
        <label>{t.utmSource}<input name="utmSource" maxLength={100} defaultValue={requested.utmSource ?? ''} /></label><label>{t.utmMedium}<input name="utmMedium" maxLength={100} defaultValue={requested.utmMedium ?? ''} /></label><label>{t.utmCampaign}<input name="utmCampaign" maxLength={100} defaultValue={requested.utmCampaign ?? ''} /></label><label>{t.utmContent}<input name="utmContent" maxLength={100} defaultValue={requested.utmContent ?? ''} /></label>
      </div></details>
      <div className="admin-filter-actions"><button className="btn-primary" type="submit">{t.apply}</button><Link className="btn-outline" href="/admin/analytics">{t.reset}</Link></div>
    </form>
    <p className="notice">{summary.capability.mode === 'exact' ? t.exactMode : t.aggregateMode}</p>
    {summary.capability.mode === 'aggregate' && <p className="notice">{t.rollupFreshness}{'partialDay' in trend && trend.partialDay ? t.partialDay(trend.partialDay) : ''}</p>}
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
    {breakdown.points && <article className="admin-panel"><DailyDimensionTrend points={breakdown.points} /></article>}
    <p className="admin-footnote">{t.footnote}</p>
  </main>;
}
