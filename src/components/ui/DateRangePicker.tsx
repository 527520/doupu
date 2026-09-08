'use client';

/**
 * 日期范围选择器（site-ui-overhaul 02）：一个月历里点两下选出起止日，
 * 用于统计与审计这类「必须成对」的筛选。对外仍是两个 `YYYY-MM-DD` 字符串，
 * `startName` / `endName` 会写入隐藏输入以兼容表单 GET。
 */
import { useId, useState, useSyncExternalStore } from 'react';
import {
  Button, DateInput, DateRangePicker as AriaDateRangePicker, DateSegment, Dialog, FieldError, Group, I18nProvider, Label, Popover, RangeCalendar,
} from 'react-aria-components';
import { getLocalTimeZone, today } from '@internationalized/date';
import Icon from './Icon';
import UiButton from './Button';
import { CalendarPane, toCalendarDate, useOpenOnFieldClick } from './DatePicker';
import useCompactLayout from './useCompactLayout';
import useVisualViewport from './useVisualViewport';
import { zhCN } from '@/messages/zh-CN';
import styles from './DateField.module.css';

export interface DateRange { start: string; end: string }

export interface DateRangePickerProps {
  label: string;
  startName?: string;
  endName?: string;
  id?: string;
  /** 不传则为非受控，配合 `defaultValue` 与 `startName`/`endName` 用于 GET 表单。 */
  value?: DateRange;
  defaultValue?: DateRange;
  onValueChange?: (value: DateRange) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  className?: string;
  hideLabel?: boolean;
  /** 起止字段的原生降级标签。 */
  startLabel?: string;
  endLabel?: string;
}

const subscribeHydration = () => () => {};

export default function DateRangePicker({ label, startName, endName, id, value: controlled, defaultValue, onValueChange: emit, min, max, disabled = false, required = false, error, className = '', hideLabel = false, startLabel, endLabel }: DateRangePickerProps) {
  const compact = useCompactLayout();
  const viewportStyle = useVisualViewport();
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState<DateRange>(defaultValue ?? { start: '', end: '' });
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const t = zhCN.datePicker;
  const value = controlled ?? inner;
  const onValueChange = (next: DateRange) => { setInner(next); emit?.(next); };
  const openOnClick = useOpenOnFieldClick(open, setOpen, disabled);

  if (!hydrated) return <div className={`${styles.field} ${className}`}>
    <span className={hideLabel ? 'sr-only' : styles.label}>{label}</span>
    <div className={styles.noscript}>
      <input id={fieldId} type="date" aria-label={startLabel ?? t.start} name={startName} value={value.start} min={min || undefined} max={value.end || max || undefined} required={required} disabled={disabled} onChange={(event) => onValueChange({ ...value, start: event.target.value })} className={styles.native} />
      <input type="date" aria-label={endLabel ?? t.end} name={endName} value={value.end} min={value.start || min || undefined} max={max || undefined} required={required} disabled={disabled} onChange={(event) => onValueChange({ ...value, end: event.target.value })} className={styles.native} />
    </div>
  </div>;

  const start = toCalendarDate(value.start);
  const end = toCalendarDate(value.end);
  const range = start && end ? { start, end } : null;
  const setDays = (days: number) => {
    const last = today(getLocalTimeZone());
    onValueChange({ start: last.subtract({ days: days - 1 }).toString(), end: last.toString() });
    setOpen(false);
  };
  return <I18nProvider locale="zh-CN">
    <AriaDateRangePicker value={range} onChange={(next) => onValueChange(next ? { start: next.start.toString(), end: next.end.toString() } : { start: '', end: '' })}
      isOpen={open} onOpenChange={setOpen} startName={startName} endName={endName}
      minValue={toCalendarDate(min) ?? undefined} maxValue={toCalendarDate(max) ?? undefined}
      isDisabled={disabled} isRequired={required} isInvalid={Boolean(error)} granularity="day" shouldForceLeadingZeros
      className={`${styles.field} ${className}`}>
      <Label className={hideLabel ? 'sr-only' : styles.label}>{label}</Label>
      <Group className={styles.group} {...openOnClick}>
        <DateInput slot="start" className={styles.input}>{(segment) => <DateSegment segment={segment} className={styles.segment} />}</DateInput>
        <span aria-hidden="true" className={styles.separator}>–</span>
        <DateInput slot="end" className={styles.input}>{(segment) => <DateSegment segment={segment} className={styles.segment} />}</DateInput>
        <Button className={styles.trigger} aria-label={t.open}><Icon name="calendar" size={18} /></Button>
      </Group>
      <FieldError className={styles.error}>{error || t.invalidRange}</FieldError>
      <Popover style={compact ? viewportStyle : undefined} className={compact ? styles.mobilePopover : styles.popover} placement="bottom start" offset={6}>
        <Dialog className={styles.dialog} aria-label={label}>
          {compact && <header className={styles.sheetHeader}><strong>{label}</strong>
            <UiButton variant="quiet" size="sm" onClick={() => setOpen(false)}>{zhCN.common.close}</UiButton>
          </header>}
          <RangeCalendar className={styles.calendar}>
            <CalendarPane range>
              <footer className={styles.footer}>
                <UiButton variant="quiet" size="sm" icon="close" onClick={() => { onValueChange({ start: '', end: '' }); setOpen(false); }}>{t.clear}</UiButton>
                <div>
                  <UiButton variant="quiet" size="sm" onClick={() => setDays(7)}>{t.lastDays(7)}</UiButton>
                  <UiButton variant="quiet" size="sm" onClick={() => setDays(30)}>{t.lastDays(30)}</UiButton>
                </div>
              </footer>
            </CalendarPane>
          </RangeCalendar>
        </Dialog>
      </Popover>
    </AriaDateRangePicker>
  </I18nProvider>;
}
