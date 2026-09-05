// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import DailyDimensionTrend from './DailyDimensionTrend';

it('shows the selected category by actual date with accessible daily data, not cross-day UV', () => {
  render(<DailyDimensionTrend points={[
    { day: '2026-05-01', value: 'mobile', events: 10, uniqueVisitors: 7 },
    { day: '2026-05-02', value: 'mobile', events: 12, uniqueVisitors: null },
    { day: '2026-05-01', value: 'desktop', events: 8, uniqueVisitors: 5 },
  ]} />);
  expect(screen.getByRole('img', { name: '2026-05-01：8 次事件' })).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: '分类值' }), { target: { value: 'mobile' } });
  expect(screen.queryByRole('img', { name: '2026-05-01：8 次事件' })).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: '2026-05-02：12 次事件' })).toHaveAttribute('tabindex', '0');
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
  expect(screen.getByText(/部分历史数据未保存/)).toBeVisible();
});
