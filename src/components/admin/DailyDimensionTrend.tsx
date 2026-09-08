'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import { useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import AnalyticsTrendChart from './AnalyticsTrendChart';

/** 面板标题由父级的 `.admin-panel > header` 提供；这里只放分类选择与折线图，选择器有面板内边距。 */
export default function DailyDimensionTrend({ points }: { points: Array<{ day: string; value: string; events: number; uniqueVisitors: number | null }> }) {
  const t = zhCN.communityAdmin.analyticsDashboard;
  const values = [...new Set(points.map((point) => point.value))].sort();
  const [selection, setSelection] = useState('');
  const selected = values.includes(selection) ? selection : values[0];
  return <section aria-label={t.dailyDimension}>
    {values.length > 0 && <div className="admin-panel-body"><ResponsiveSelect label={t.value} value={selected} onValueChange={setSelection} options={values.map(value=>({value,label:value}))} className="admin-dimension-select" /></div>}
    <AnalyticsTrendChart points={points.filter((point) => point.value === selected)} />
  </section>;
}
