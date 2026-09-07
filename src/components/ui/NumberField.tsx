'use client';

/**
 * 数字输入（site-ui-overhaul 02）：两侧豆粒步进按钮 + 中间可直接键入的输入框。
 * `value` 为 undefined 表示留空（例如「沿用统一参数」），清空输入即回到 undefined。
 */
import { useId, type ReactNode } from 'react';
import { Button, Group, Input, Label, NumberField as AriaNumberField, Text } from 'react-aria-components';
import Icon from './Icon';
import { zhCN } from '@/messages/zh-CN';

export interface NumberFieldProps {
  label: ReactNode;
  value: number | undefined;
  onValueChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  description?: string;
  className?: string;
  hideLabel?: boolean;
  /** 紧凑：36px 高，用于参数面板。 */
  compact?: boolean;
}

export default function NumberField({ label, value, onValueChange, min, max, step = 1, placeholder, disabled = false, required = false, name, id, description, className = '', hideLabel = false, compact = false }: NumberFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return <AriaNumberField value={value ?? NaN} onChange={(next) => onValueChange(Number.isNaN(next) ? undefined : next)} minValue={min} maxValue={max} step={step}
    isDisabled={disabled} isRequired={required} name={name} formatOptions={{ maximumFractionDigits: 0 }}
    className={`number-field${compact ? ' is-compact' : ''} ${className}`}>
    <Label className={hideLabel ? 'sr-only' : 'number-field-label'}>{label}</Label>
    <Group className="number-field-group">
      <Button slot="decrement" className="number-field-step" aria-label={zhCN.numberField.decrement}><Icon name="minus" size={16} /></Button>
      <Input id={fieldId} className="number-field-input" placeholder={placeholder} inputMode="numeric" />
      <Button slot="increment" className="number-field-step" aria-label={zhCN.numberField.increment}><Icon name="plus" size={16} /></Button>
    </Group>
    {description && <Text slot="description" className="number-field-description">{description}</Text>}
  </AriaNumberField>;
}
