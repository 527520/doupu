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
  'aria-describedby'?: string;
}
const subscribeHydration = () => () => {};

/** A single selection/form state for anchored desktop and touch-friendly sheet.
 * Only presentation changes at the breakpoint; callers keep business transitions.
 */
export default function ResponsiveSelect({ label, options, name, id, value, defaultValue, onValueChange,
  disabled = false, required = false, error, className = '', hideLabel = false,
  'aria-describedby': describedBy,
}: ResponsiveSelectProps) {
  const compact = useCompactLayout();
  const viewportStyle=useVisualViewport();
  const [open, setOpen] = useState(false);
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const initial = defaultValue ?? options.find((option) => !option.disabled)?.value;
  // An operable, labelled GET/form control is delivered even with JS disabled.
  if (!hydrated) return <label className={`${styles.field} ${className}`}>
    <span className={hideLabel ? 'sr-only' : styles.label}>{label}</span>
    <select id={fieldId} name={name} value={value} defaultValue={value === undefined ? initial : undefined}
      required={required} disabled={disabled} aria-describedby={describedBy}
      onChange={(event) => onValueChange?.(event.target.value)} className={styles.trigger}>
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  </label>;

  const list = <ListBox items={options} className={styles.list} renderEmptyState={() => <p className={styles.empty}>{zhCN.selection.empty}</p>}>
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
    placeholder={zhCN.selection.placeholder} className={`${styles.field} ${className}`}>
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
