import { zhCN } from '@/messages/zh-CN';

export default function AnalyticsTrendChart({ points }: { points: Array<{ day: string; events: number; uniqueVisitors: number | null }> }) {
  const t = zhCN.communityAdmin.analyticsDashboard;
  if (points.length === 0) return <div className="admin-empty">{t.empty}</div>;
  const max = Math.max(...points.map((point) => point.events), 1);
  const firstDay = Date.parse(points[0].day);
  const lastDay = Date.parse(points[points.length - 1].day);
  const coordinates = points.map((point) => ({
    ...point,
    x: lastDay === firstDay ? 320 : 28 + ((Date.parse(point.day) - firstDay) * 584) / (lastDay - firstDay),
    y: 176 - (point.events / max) * 140,
  }));
  return <>
    <figure className="analytics-chart">
      <figcaption>{t.chartCaption(max.toLocaleString('zh-CN'))}</figcaption>
      <svg viewBox="0 0 640 200" role="group" aria-label={t.chartLabel}>
        <g aria-hidden="true" className="analytics-chart-axis"><path d="M 28 20 V 176 H 612" fill="none" stroke="currentColor" strokeWidth="1" /><text x="28" y="194">{points[0].day}</text><text x="612" y="194" textAnchor="end">{points[points.length - 1].day}</text></g>
        <path d={`M ${coordinates.map((point) => `${point.x} ${point.y}`).join(' L ')}`} fill="none" stroke="currentColor" strokeWidth="3" />
        {coordinates.map((point) => <circle key={point.day} cx={point.x} cy={point.y} r="5" tabIndex={0} role="img" aria-label={t.chartPoint(point.day, point.events)}><title>{t.chartPoint(point.day, point.events)}</title></circle>)}
      </svg>
    </figure>
    {points.some((point) => point.uniqueVisitors === null) && <p className="notice">{t.legacyDailyUvUnavailable}</p>}
    <div className="admin-table-scroll admin-chart-data" tabIndex={0} role="region" aria-label={t.trendTable}><table><caption className="sr-only">{t.trendTable}</caption><thead><tr><th>{t.day}</th><th>{t.events}</th><th>{t.visitors}</th></tr></thead><tbody>{points.map((point) => <tr key={point.day}><td>{point.day}</td><td>{point.events}</td><td>{point.uniqueVisitors ?? t.emptyValue}</td></tr>)}</tbody></table></div>
  </>;
}

