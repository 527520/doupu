'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import { useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import AnalyticsTrendChart from './AnalyticsTrendChart';

export default function DailyDimensionTrend({ points }: { points: Array<{ day: string; value: string; events: number; uniqueVisitors: number | null }> }) {
  const t = zhCN.communityAdmin.analyticsDashboard;
  const values = [...new Set(points.map((point) => point.value))].sort();
  const [selection, setSelection] = useState('');
  const selected = values.includes(selection) ? selection : values[0];
  return <section aria-label={t.dailyDimension}><h3>{t.dailyDimension}</h3>
    {values.length > 0 && <ResponsiveSelect label={t.value} value={selected} onValueChange={setSelection} options={values.map(value=>({value,label:value}))} />}
    <AnalyticsTrendChart points={points.filter((point) => point.value === selected)} />
  </section>;
}
