import { forbidden } from 'next/navigation';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import DateRangePicker from '@/components/ui/DateRangePicker';
import Disclosure from '@/components/ui/Disclosure';
import Button, { ButtonLink } from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import TextField from '@/components/ui/TextField';
import { AdminEmpty } from '@/components/admin/AdminPrimitives';
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
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { zhCN } from '@/messages/zh-CN';

import TrendChart from '@/components/admin/AnalyticsTrendChart';
import DailyDimensionTrend from '@/components/admin/DailyDimensionTrend';

type Dashboard = typeof zhCN.communityAdmin.analyticsDashboard;
/** 分类值尽量映射成中文（设备 / 浏览器 / 系统 / 身份 / 事件名）；路径与域名等原样展示。 */
function dimensionValueLabel(t: Dashboard, dimension: string, value: string): string {
  const maps: Record<string, Record<string, string>> = { device: t.devices, browser: t.browsers, os: t.systems, actor: t.actors, event: t.steps };
  return maps[dimension]?.[value] ?? value;
}

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
    <AdminPageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} />
    {invalid && <Notice kind="warning" role="alert">{t.invalidQuery}</Notice>}
    <form className="admin-panel admin-analytics-form" method="get">
      {/* 主筛选一行：范围占两格，其余各一格，查询 / 重置在行尾，全部 44 高、底边对齐。 */}
      <div className="admin-analytics-filters form-row">
        <DateRangePicker label={t.range} startName="start" endName="end" startLabel={t.start} endLabel={t.end} defaultValue={{ start: requested.start ?? '', end: requested.end ?? '' }} className="form-row-wide" />
        <TextField label={t.eventName} name="eventName" maxLength={80} defaultValue={requested.eventName ?? ''} placeholder={t.eventExample} />
        <ResponsiveSelect label={t.dimension} name="dimension" defaultValue={dimension} options={dimensions.map(([value,label])=>({value,label}))} />
        <ResponsiveSelect label={t.funnel} name="funnel" defaultValue={funnel} options={funnelNames.map(([value,label])=>({value,label}))} />
        <div className="form-row-actions"><ButtonLink variant="quiet" href="/admin/analytics">{t.reset}</ButtonLink><Button variant="primary" type="submit" icon="search">{t.apply}</Button></div>
      </div>
      <Disclosure className="admin-advanced-filters is-flat" icon="filter" summary={t.advanced} defaultExpanded={DASHBOARD_COMBINATION_FILTERS.some((key) => requested[key] !== undefined)}><p className="admin-help">{t.advancedHint}</p><div className="admin-analytics-filters form-row">
        {select('device', t.device, t.devices)}{select('browser', t.browser, t.browsers)}{select('os', t.os, t.systems)}{select('actor', t.actor, t.actors)}
        <TextField label={t.path} name="path" maxLength={200} defaultValue={requested.path ?? ''} /><TextField label={t.referrer} name="referrer" maxLength={253} defaultValue={requested.referrer ?? ''} />
        <TextField label={t.utmSource} name="utmSource" maxLength={100} defaultValue={requested.utmSource ?? ''} /><TextField label={t.utmMedium} name="utmMedium" maxLength={100} defaultValue={requested.utmMedium ?? ''} /><TextField label={t.utmCampaign} name="utmCampaign" maxLength={100} defaultValue={requested.utmCampaign ?? ''} /><TextField label={t.utmContent} name="utmContent" maxLength={100} defaultValue={requested.utmContent ?? ''} />
      </div></Disclosure>
    </form>
    <Notice kind="info">{summary.capability.mode === 'exact' ? t.exactMode : t.aggregateMode}</Notice>
    {summary.capability.mode === 'aggregate' && <Notice kind="info">{t.rollupFreshness}{'partialDay' in trend && trend.partialDay ? t.partialDay(trend.partialDay) : ''}</Notice>}
    {filtersIgnored && <Notice kind="warning">{t.ignoredFilters}</Notice>}
    <section className="admin-metrics" aria-label={t.summary}>
      <article><small>{t.eventsCode}</small><strong>{summary.totals.events.toLocaleString('zh-CN')}</strong><span>{t.eventsHelp}</span></article>
      <article><small>{t.visitorsCode}</small><strong>{summary.totals.uniqueVisitors?.toLocaleString('zh-CN') ?? t.emptyValue}</strong><span>{t.visitorsHelp}</span></article>
      <article><small>{t.sessionsCode}</small><strong>{summary.totals.sessions?.toLocaleString('zh-CN') ?? t.emptyValue}</strong><span>{t.sessionsHelp}</span></article>
    </section>
    <section className="admin-proof-grid">
      <article className="admin-panel"><header><h2>{t.trend}</h2><span>{query.start} — {query.end}</span></header><TrendChart points={trend.points.map((point) => ({ day: point.day, events: point.events, uniqueVisitors: point.uniqueVisitors }))} /></article>
      <article className="admin-panel"><header><h2>{t.deviceBreakdown}</h2><span>{t.dimensions[dimension as keyof typeof t.dimensions] ?? t.singleDimensionUv}</span></header>{breakdown.values.length === 0 ? <AdminEmpty icon="chart" title={t.noDimension} /> : <table><caption className="sr-only">{t.dimensionCaption}</caption><thead><tr><th>{t.value}</th><th>{t.events}</th><th>{t.visitors}</th></tr></thead><tbody>{breakdown.values.map((row) => <tr key={row.value}><td>{dimensionValueLabel(t, dimension, row.value)}</td><td>{row.events}</td><td>{row.uniqueVisitors ?? t.emptyValue}</td></tr>)}</tbody></table>}</article>
      <article className="admin-panel admin-panel-funnel"><header><h2>{t.funnelTitle}</h2><span>{t.funnelNames[funnel]}</span></header><p className="admin-help admin-panel-help">{t.funnelHelp}</p>{funnelResult.steps ? <table><caption className="sr-only">{t.funnelTitle}</caption><thead><tr><th>{t.step}</th><th>{t.reachedSessions}</th><th>{t.conversion}</th></tr></thead><tbody>{funnelResult.steps.map((step) => <tr key={step.name}><td>{t.steps[step.name as keyof typeof t.steps]}</td><td>{step.sessions}</td><td>{step.conversionFromPrevious === null ? t.emptyValue : `${Math.round(step.conversionFromPrevious * 100)}%`}</td></tr>)}</tbody></table> : <AdminEmpty icon="chart" title={funnelResult.unavailableReason} />}</article>
    </section>
    {breakdown.points && <article className="admin-panel"><header><h2>{t.dailyDimension}</h2><span>{t.dimensions[dimension as keyof typeof t.dimensions] ?? ''}</span></header><DailyDimensionTrend points={breakdown.points} /></article>}
    <p className="admin-footnote">{t.footnote}</p>
  </main>;
}
