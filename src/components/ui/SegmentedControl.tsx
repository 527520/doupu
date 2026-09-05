'use client';

import { useId } from 'react';
import type { SelectOption } from './ResponsiveSelect';

/** Native radios retain form submission, reset, arrow-key navigation and no-JS use. */
export default function SegmentedControl({ label, name, options, value, defaultValue, onValueChange, disabled = false }: {
  label: string; name?: string; options: readonly SelectOption[]; value?: string; defaultValue?: string;
  onValueChange?: (value: string) => void; disabled?: boolean;
}) {
  const generated = useId();
  return <fieldset className="segmented-control" disabled={disabled}><legend className="sr-only">{label}</legend>
    {options.map((option) => <label key={option.value}>
      <input type="radio" name={name ?? generated} value={option.value} disabled={option.disabled}
        checked={value === undefined ? undefined : value === option.value}
        defaultChecked={value === undefined ? (defaultValue ?? options[0]?.value) === option.value : undefined}
        onChange={()=>onValueChange?.(option.value)} />
      <span>{option.label}</span>
    </label>)}
  </fieldset>;
}
