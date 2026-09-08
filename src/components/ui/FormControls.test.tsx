// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import DatePicker from './DatePicker';
import DateRangePicker from './DateRangePicker';
import NumberField from './NumberField';
import Disclosure from './Disclosure';
import Checkbox from './Checkbox';
import Textarea from './Textarea';
import Chip from './Chip';
import Badge from './Badge';
import EmptyState from './EmptyState';
import SegmentedControl from './SegmentedControl';
import { zhCN } from '@/messages/zh-CN';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function ControlledDate({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><DatePicker label="发布日期" name="from" value={value} onValueChange={setValue} /><output data-testid="value">{value}</output></>;
}

describe('DatePicker', () => {
  it('以 YYYY-MM-DD 字符串交互，并把值写入同名隐藏输入供 GET 表单提交', async () => {
    const { container } = render(<ControlledDate initial="2026-09-07" />);
    await waitFor(() => expect(container.querySelector('input[name="from"]')).toBeTruthy());
    expect((container.querySelector('input[name="from"]') as HTMLInputElement).value).toBe('2026-09-07');
    expect(screen.getByText('发布日期')).toBeTruthy();
  });

  it('打开日历后「清除」清空值，「今天」写入今天', async () => {
    render(<ControlledDate initial="2026-09-07" />);
    await screen.findByRole('button', { name: new RegExp(zhCN.datePicker.open) });
    await userEvent.click(screen.getByRole('button', { name: new RegExp(zhCN.datePicker.open) }));
    await userEvent.click(await screen.findByRole('button', { name: zhCN.datePicker.clear }));
    expect(screen.getByTestId('value')).toHaveTextContent('');
    await userEvent.click(screen.getByRole('button', { name: new RegExp(zhCN.datePicker.open) }));
    await userEvent.click(await screen.findByRole('button', { name: zhCN.datePicker.today }));
    expect(screen.getByTestId('value').textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('日历里点选日期即提交并关闭', async () => {
    render(<ControlledDate initial="2026-09-07" />);
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(zhCN.datePicker.open) }));
    const dialog = await screen.findByRole('dialog');
    const cell = dialog.querySelector('[role="gridcell"] [role="button"][aria-label*="15"]') ?? dialog.querySelector('td [role="button"]');
    expect(cell).toBeTruthy();
    await userEvent.click(cell as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('value').textContent).toMatch(/^2026-/));
  });

  it('非受控 + 无 onValueChange 时自行维护状态', async () => {
    const { container } = render(<DatePicker label="日期" name="d" defaultValue="2026-01-02" />);
    await waitFor(() => expect((container.querySelector('input[name="d"]') as HTMLInputElement).value).toBe('2026-01-02'));
  });

  it('点字段任意位置（不只是日历按钮）都能打开月历；禁用时不打开', async () => {
    const { container, unmount } = render(<ControlledDate initial="2026-09-07" />);
    await screen.findByRole('button', { name: new RegExp(zhCN.datePicker.open) });
    // 真实落点几乎总是某个分段：react-aria 会在分段 / 日期输入层截断冒泡，Group 上的普通 onClick 收不到。
    const segment = container.querySelector('[role="spinbutton"]') as HTMLElement;
    expect(segment).toBeTruthy();
    await userEvent.click(segment);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    // 月历开着时再点字段不会把它「再打开一次」或关掉：交给 react-aria 自己的开合规则
    await userEvent.click(segment);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // 点空白处（不是分段、不是日历按钮）同样能打开
    await userEvent.click(container.querySelector('[role="group"]') as HTMLElement);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    unmount();
    const disabled = render(<DatePicker label="日期" name="d" defaultValue="2026-01-02" disabled />);
    await screen.findByRole('button', { name: new RegExp(zhCN.datePicker.open) });
    await userEvent.click(disabled.container.querySelector('[role="group"]') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('SegmentedControl', () => {
  it('原生单选承担状态；轨道知道选项数以便滑块均分，可见标签可选', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<SegmentedControl label="取样模式" value="dominant" onValueChange={onChange}
      options={[{ value: 'dominant', label: '主色' }, { value: 'average', label: '平均色' }]} />);
    const fieldset = container.querySelector('fieldset.segmented-control') as HTMLElement;
    expect(fieldset.style.getPropertyValue('--n')).toBe('2');
    expect(container.querySelector('.segmented-track')).toBeTruthy();
    expect(screen.queryByText('取样模式', { selector: '.field-label' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: '平均色' }));
    expect(onChange).toHaveBeenCalledWith('average');
    rerender(<SegmentedControl label="取样模式" value="average" showLabel size="sm" onValueChange={onChange}
      options={[{ value: 'dominant', label: '主色' }, { value: 'average', label: '平均色' }]} />);
    expect(screen.getByText('取样模式', { selector: '.field-label' })).toBeTruthy();
    expect(fieldset.className).toContain('is-sm');
    expect(screen.getByRole('radio', { name: '平均色' })).toBeChecked();
  });
});

describe('DateRangePicker', () => {
  it('起止写入两个隐藏输入，「近 7 天」写入相邻 7 天', async () => {
    function Wrapper() {
      const [value, setValue] = useState({ start: '2026-09-01', end: '2026-09-07' });
      return <><DateRangePicker label="时间范围" startName="start" endName="end" value={value} onValueChange={setValue} /><output data-testid="range">{value.start}|{value.end}</output></>;
    }
    const { container } = render(<Wrapper />);
    await waitFor(() => expect((container.querySelector('input[name="start"]') as HTMLInputElement).value).toBe('2026-09-01'));
    expect((container.querySelector('input[name="end"]') as HTMLInputElement).value).toBe('2026-09-07');
    await userEvent.click(screen.getByRole('button', { name: new RegExp(zhCN.datePicker.open) }));
    await userEvent.click(await screen.findByRole('button', { name: zhCN.datePicker.lastDays(7) }));
    const [start, end] = screen.getByTestId('range').textContent!.split('|');
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    expect(days).toBe(6);
  });
});

describe('NumberField', () => {
  it('步进按钮受 min/max 约束，清空得到 undefined', async () => {
    const onChange = vi.fn();
    function Wrapper() {
      const [value, setValue] = useState<number | undefined>(2);
      return <NumberField label="颗数" value={value} min={1} max={3} onValueChange={(next) => { setValue(next); onChange(next); }} />;
    }
    render(<Wrapper />);
    await userEvent.click(screen.getByRole('button', { name: new RegExp(zhCN.numberField.increment) }));
    expect(onChange).toHaveBeenLastCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: new RegExp(zhCN.numberField.increment) }));
    expect(onChange).toHaveBeenLastCalledWith(3);
    const input = screen.getByRole('textbox', { name: /颗数/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe('Disclosure', () => {
  it('触发器是带 aria-expanded 的按钮，点击切换面板', async () => {
    render(<Disclosure summary="更多筛选" meta="已启用 2 项"><p>面板内容</p></Disclosure>);
    const trigger = screen.getByRole('button', { name: /更多筛选/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('面板内容')).toBeVisible();
  });
});

describe('Checkbox / Textarea / Chip / Badge / EmptyState', () => {
  it('Checkbox 用原生 input 承担状态与可访问名称', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="发布" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: '发布' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Textarea 显示计数并把错误绑定到 aria-describedby', () => {
    render(<Textarea label="评论" value="你好" maxLength={500} onValueChange={() => {}} error="太短" />);
    const field = screen.getByLabelText('评论');
    expect(screen.getByText('2/500')).toBeTruthy();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(field.getAttribute('aria-describedby')!)).toHaveTextContent('太短');
  });

  it('Chip 用 aria-pressed 表达选中并展示计数；Badge 写入语气；EmptyState 有钉板纹理', () => {
    render(<><Chip pressed count={3}>已保存</Chip><Badge tone="ok">已发布</Badge><EmptyState title="还没有作品" description="上传第一张图开始。" /></>);
    expect(screen.getByRole('button', { name: /已保存/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /已保存/ }).querySelector('small')).toHaveTextContent('3');
    expect(screen.getByText('已发布').closest('.badge')).toHaveAttribute('data-tone', 'ok');
    expect(screen.getByText('还没有作品').closest('.empty-state')?.className).toContain('pegboard');
  });
});
