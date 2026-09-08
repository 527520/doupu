'use client';

/**
 * 日期选择器（site-ui-overhaul 02）。
 *
 * 之前三处筛选直接裸用 `<input type="date">`，观感完全取决于浏览器。这里基于
 * react-aria-components 的 DatePicker：中文月历、键盘分段输入、桌面锚定弹层、
 * 手机底部面板（与 ResponsiveSelect 同一套呈现规则）。对外仍以 `YYYY-MM-DD`
 * 字符串交互，兼容现有 URL 查询参数与表单 GET 提交（`name` 会写入隐藏输入）。
 * 未水合前渲染原生日期输入，保证无 JS 时依旧可用。
 */
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  Button, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell,
  DateInput, DatePicker as AriaDatePicker, DateSegment, Dialog, FieldError, Group, Heading, I18nProvider, Label, Popover,
} from 'react-aria-components';
import { getLocalTimeZone, isSameDay, parseDate, today, type CalendarDate } from '@internationalized/date';
import Icon from './Icon';
import UiButton from './Button';
import useCompactLayout from './useCompactLayout';
import useVisualViewport from './useVisualViewport';
import { zhCN } from '@/messages/zh-CN';
import styles from './DateField.module.css';

export interface DatePickerProps {
  label: string;
  name?: string;
  id?: string;
  /** `YYYY-MM-DD`，空字符串表示未选择；不传则为非受控，配合 `defaultValue` 与 `name` 用于 GET 表单。 */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  className?: string;
  hideLabel?: boolean;
  /** 弹层底部的额外快捷操作。 */
  footer?: ReactNode;
}

const subscribeHydration = () => () => {};

export function toCalendarDate(value: string | undefined): CalendarDate | null {
  if (!value) return null;
  try { return parseDate(value); } catch { return null; }
}

export function CalendarPane({ range = false, children }: { range?: boolean; children?: ReactNode }) {
  const todayDate = today(getLocalTimeZone());
  return <>
    <header className={styles.calendarHeader}>
      <Button slot="previous" className={styles.nav} aria-label={zhCN.datePicker.previousMonth}><Icon name="chevron-left" size={18} /></Button>
      <Heading />
      <Button slot="next" className={styles.nav} aria-label={zhCN.datePicker.nextMonth}><Icon name="chevron-right" size={18} /></Button>
    </header>
    <CalendarGrid className={styles.grid} weekdayStyle="narrow">
      <CalendarGridHeader>{(day) => <CalendarHeaderCell className={styles.headerCell}>{day}</CalendarHeaderCell>}</CalendarGridHeader>
      <CalendarGridBody>{(date) => <CalendarCell date={date} className={`${styles.cell}${range ? ` ${styles.rangeCell}` : ''}`} data-today={isSameDay(date, todayDate) || undefined} />}</CalendarGridBody>
    </CalendarGrid>
    {children}
  </>;
}

export default function DatePicker({ label, name, id, value: controlled, defaultValue = '', onValueChange: emit, min, max, disabled = false, required = false, error, className = '', hideLabel = false, footer }: DatePickerProps) {
  const compact = useCompactLayout();
  const viewportStyle = useVisualViewport();
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(defaultValue);
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const t = zhCN.datePicker;
  const value = controlled ?? inner;
  const onValueChange = (next: string) => { setInner(next); emit?.(next); };

  if (!hydrated) return <label className={`${styles.field} ${className}`}>
    <span className={hideLabel ? 'sr-only' : styles.label}>{label}</span>
    <input id={fieldId} type="date" name={name} value={value} min={min || undefined} max={max || undefined} required={required} disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)} className={styles.native} />
  </label>;

  const date = toCalendarDate(value);
  return <I18nProvider locale="zh-CN">
    <AriaDatePicker value={date} onChange={(next) => onValueChange(next ? next.toString() : '')} isOpen={open} onOpenChange={setOpen}
      name={name} minValue={toCalendarDate(min) ?? undefined} maxValue={toCalendarDate(max) ?? undefined}
      isDisabled={disabled} isRequired={required} isInvalid={Boolean(error)} granularity="day" shouldForceLeadingZeros
      className={`${styles.field} ${className}`}>
      <Label className={hideLabel ? 'sr-only' : styles.label}>{label}</Label>
      {/* 整块可点：点分段、点空白都打开月历，不必瞄准右侧那颗小日历按钮；键盘分段输入不受影响。 */}
      <Group className={styles.group} onClick={() => { if (!disabled) setOpen(true); }}>
        <DateInput className={styles.input}>{(segment) => <DateSegment segment={segment} className={styles.segment} />}</DateInput>
        <Button className={styles.trigger} aria-label={t.open}><Icon name="calendar" size={18} /></Button>
      </Group>
      <FieldError className={styles.error}>{error || t.invalid}</FieldError>
      <Popover style={compact ? viewportStyle : undefined} className={compact ? styles.mobilePopover : styles.popover} placement="bottom start" offset={6}>
        <Dialog className={styles.dialog} aria-label={label}>
          {compact && <header className={styles.sheetHeader}><strong>{label}</strong>
            <UiButton variant="quiet" size="sm" onClick={() => setOpen(false)}>{zhCN.common.close}</UiButton>
          </header>}
          <Calendar className={styles.calendar}>
            <CalendarPane>
              <footer className={styles.footer}>
                <UiButton variant="quiet" size="sm" icon="close" onClick={() => { onValueChange(''); setOpen(false); }}>{t.clear}</UiButton>
                <div>{footer}<UiButton variant="quiet" size="sm" onClick={() => { onValueChange(today(getLocalTimeZone()).toString()); setOpen(false); }}>{t.today}</UiButton></div>
              </footer>
            </CalendarPane>
          </Calendar>
        </Dialog>
      </Popover>
    </AriaDatePicker>
  </I18nProvider>;
}
