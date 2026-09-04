import { forbidden } from 'next/navigation';
import { getDb } from '@/lib/auth/db';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { queryAnalyticsDimensions, queryAnalyticsSummary, queryAnalyticsTrend } from '@/lib/analytics/reports';
import { toShanghaiDay } from '@/lib/analytics/time';

const DAY_MS = 24 * 60 * 60 * 1000;

function TrendChart({ points }: { points: Array<{ day: string; events: number }> }) {
  if (points.length === 0) return <div className="admin-empty">所选范围还没有已同意访客的事件。</div>;
  const max = Math.max(...points.map((point) => point.events), 1);
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? 320 : 28 + (index * 584) / (points.length - 1),
    y: 176 - (point.events / max) * 140,
  }));
  return (
    <figure className="analytics-chart">
      <figcaption>每日事件量；最高 {max.toLocaleString('zh-CN')} 次</figcaption>
      <svg viewBox="0 0 640 200" role="img" aria-label="每日事件量折线图">
        <path d={`M ${coordinates.map((point) => `${point.x} ${point.y}`).join(' L ')}`} fill="none" stroke="currentColor" strokeWidth="3" />
        {coordinates.map((point) => (
          <circle key={point.day} cx={point.x} cy={point.y} r="5" tabIndex={0}>
            <title>{point.day}：{point.events} 次事件</title>
          </circle>
        ))}
      </svg>
    </figure>
  );
}

export default async function AnalyticsPage() {
  const actor = await getSessionActor();
  if (!authorize(actor, 'analytics:read')) forbidden();
  const now = new Date();
  const query = { start: toShanghaiDay(new Date(now.getTime() - 29 * DAY_MS)), end: toShanghaiDay(now) };
  const db = getDb();
  const [summary, trend, devices] = await Promise.all([
    queryAnalyticsSummary(db, query, now),
    queryAnalyticsTrend(db, query, now),
    queryAnalyticsDimensions(db, query, 'device', now),
  ]);
  return (
    <main id="main" className="admin-page">
      <header className="admin-page-header"><div><span>ANALYTICS / 30D</span><h1>匿名分析校样</h1></div><p>Asia/Shanghai · 最近 30 天 · 精确会话口径</p></header>
      <section className="admin-metrics" aria-label="摘要">
        <article><small>EVENTS</small><strong>{summary.totals.events.toLocaleString('zh-CN')}</strong><span>事件</span></article>
        <article><small>VISITORS</small><strong>{summary.totals.uniqueVisitors?.toLocaleString('zh-CN') ?? '—'}</strong><span>范围 UV</span></article>
        <article><small>SESSIONS</small><strong>{summary.totals.sessions?.toLocaleString('zh-CN') ?? '—'}</strong><span>30 分钟会话</span></article>
      </section>
      <section className="admin-proof-grid">
        <article className="admin-panel"><header><h2>事件趋势</h2><span>{query.start} — {query.end}</span></header><TrendChart points={trend.points.map((point) => ({ day: point.day, events: point.events }))} /></article>
        <article className="admin-panel"><header><h2>设备分类</h2><span>单维 UV</span></header>
          {devices.values.length === 0 ? <div className="admin-empty">暂无设备分类数据。</div> : (
            <table><caption className="sr-only">按设备类别统计的事件与访客</caption><thead><tr><th>设备</th><th>事件</th><th>访客</th></tr></thead><tbody>
              {devices.values.map((row) => <tr key={row.value}><td>{row.value}</td><td>{row.events}</td><td>{row.uniqueVisitors}</td></tr>)}
            </tbody></table>
          )}
        </article>
      </section>
      <p className="admin-footnote">超过 90 天的查询自动降为日总量与单维趋势，并明确隐藏跨日 UV 与漏斗。</p>
    </main>
  );
}
