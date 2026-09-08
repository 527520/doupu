'use client';

import { useId, useState, useSyncExternalStore } from 'react';
import {
  Select, Label, Button, SelectValue, ListBox, ListBoxItem, Text, FieldError,
  Popover, Autocomplete, SearchField, Input,
} from 'react-aria-components';
import { zhCN } from '@/messages/zh-CN';
import useCompactLayout from './useCompactLayout';
import useVisualViewport from './useVisualViewport';
import styles from './ResponsiveSelect.module.css';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  colors?: readonly string[];
  disabled?: boolean;
}
export interface ResponsiveSelectProps {
  label: string;
  options: readonly SelectOption[];
  name?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  className?: string;
  hideLabel?: boolean;
  /** 尺寸档：md = 44（表单行），sm = 36（参数面板等工具行）。 */
  size?: 'md' | 'sm';
  'aria-describedby'?: string;
}
const subscribeHydration = () => () => {};

/** A single selection/form state for anchored desktop and touch-friendly sheet.
 * Only presentation changes at the breakpoint; callers keep business transitions.
 */
export default function ResponsiveSelect({ label, options, name, id, value, defaultValue, onValueChange,
  disabled = false, required = false, error, className = '', hideLabel = false, size = 'md',
  'aria-describedby': describedBy,
}: ResponsiveSelectProps) {
  const compact = useCompactLayout();
  const viewportStyle=useVisualViewport();
  const [open, setOpen] = useState(false);
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const initial = defaultValue ?? options.find((option) => !option.disabled)?.value;
  const fieldClass = `${styles.field}${size === 'sm' ? ` ${styles.sm}` : ''} ${className}`;
  // An operable, labelled GET/form control is delivered even with JS disabled.
  if (!hydrated) return <label className={fieldClass}>
    <span className={hideLabel ? 'sr-only' : styles.label}>{label}</span>
    <select id={fieldId} name={name} value={value} defaultValue={value === undefined ? initial : undefined}
      required={required} disabled={disabled} aria-describedby={describedBy}
      onChange={(event) => onValueChange?.(event.target.value)} className={styles.trigger}>
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  </label>;

  // Select 默认「按下即开、松手即选」：桌面浮层锚在触发器下方，松手落在触发器上没事；
  // 底部抽屉却会盖到触发器所在位置，鼠标松开时正压在某个选项上就被误选。
  // 紧凑档改成只认选项自己的按压（鼠标在选项上按下、触摸在选项上抬起），打开时那次松手不再算选择。
  const list = <ListBox items={options} className={styles.list} shouldSelectOnPressUp={compact ? false : undefined}
    renderEmptyState={() => <p className={styles.empty}>{zhCN.selection.empty}</p>}>
    {(option) => <ListBoxItem id={option.value} textValue={option.label} className={styles.option}>
      {({ isSelected }) => <>
        <span className={styles.optionCopy}><Text slot="label">{option.label}</Text>
          {option.description && <Text slot="description">{option.description}</Text>}
          {option.colors && <span aria-hidden="true" className={styles.colors}>{option.colors.slice(0, 8).map((color, index) => <i key={index} style={{ backgroundColor: color }} />)}</span>}
        </span>
        <span aria-hidden="true" className={styles.check}>{isSelected ? '✓' : ''}</span>
      </>}
    </ListBoxItem>}
  </ListBox>;
  const choices = options.length > 12 ? <Autocomplete filter={(text, query) => text.normalize('NFKC').toLocaleLowerCase().includes(query.normalize('NFKC').toLocaleLowerCase())}>
    <SearchField aria-label={zhCN.selection.search} className={styles.search}>
      <Input placeholder={zhCN.selection.search} onKeyDownCapture={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      }} />
    </SearchField>{list}
  </Autocomplete> : list;
  return <Select isOpen={open} onOpenChange={setOpen} name={name} value={value} defaultValue={value === undefined ? initial : undefined}
    onChange={(key) => { if (key !== null) onValueChange?.(String(key)); }}
    isDisabled={disabled} isRequired={required} isInvalid={Boolean(error)}
    disabledKeys={options.filter((option) => option.disabled).map((option) => option.value)}
    placeholder={zhCN.selection.placeholder} className={fieldClass}>
    <Label className={hideLabel ? 'sr-only' : styles.label}>{label}</Label>
    <Button id={fieldId} className={styles.trigger} aria-describedby={describedBy}>
      <SelectValue className={styles.value}>{({ selectedText }) => selectedText || zhCN.selection.placeholder}</SelectValue>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </Button>
    <FieldError className={styles.error}>{error || zhCN.selection.required}</FieldError>
    <Popover style={compact ? viewportStyle : undefined} className={compact ? styles.mobilePopover : styles.popover} placement="bottom start" offset={6}>
      {compact && <header className={styles.sheetHeader}><strong>{label}</strong>
        <button type="button" className={styles.close} aria-label={zhCN.selection.close} onClick={()=>setOpen(false)}>×</button>
      </header>}{choices}
    </Popover>
  </Select>;
}
