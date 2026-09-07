'use client';

/**
 * 复选框（site-ui-overhaul 02）。原生 input 铺满整个控件（与 Switch 同一教训：
 * 1×1 的隐藏 input 在 Firefox 上真实指针事件会落到旁边），视觉用自绘方框 + 勾。
 */
import type { ReactNode } from 'react';
import Icon from './Icon';

export interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  value?: string;
  description?: ReactNode;
  className?: string;
  'aria-describedby'?: string;
}

export default function Checkbox({ label, checked, onChange, disabled = false, name, value, description, className = '', 'aria-describedby': describedBy }: CheckboxProps) {
  return <label className={`checkbox-control${className ? ` ${className}` : ''}`}>
    <input type="checkbox" name={name} value={value} checked={checked} disabled={disabled} aria-describedby={describedBy} onChange={(event) => onChange(event.target.checked)} />
    <span className="checkbox-box" aria-hidden="true"><Icon name="check" size={14} /></span>
    <span className="checkbox-copy"><span>{label}</span>{description && <small>{description}</small>}</span>
  </label>;
}
