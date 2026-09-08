'use client';

import { useId, type CSSProperties } from 'react';
import type { SelectOption } from './ResponsiveSelect';

export interface SegmentedControlProps {
  label: string;
  name?: string;
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  /** 在轨道上方显示可见标签（与相邻字段的标签行对齐）；默认只给读屏器。 */
  showLabel?: boolean;
  /** 尺寸档：md = 44（表单行），sm = 36（参数面板等工具行）。 */
  size?: 'md' | 'sm';
  className?: string;
}

/**
 * 分段选择（ui-polish-2026）：原生单选保留表单提交、重置、方向键与无 JS 可用；
 * 视觉上是一条下沉轨道 + 一枚滑动的白色豆片，选中项切换时豆片滑过去（CSS `:has()` 读选中序号）。
 */
export default function SegmentedControl({ label, name, options, value, defaultValue, onValueChange, disabled = false, showLabel = false, size = 'md', className = '' }: SegmentedControlProps) {
  const generated = useId();
  const style = { '--n': options.length } as CSSProperties;
  return <fieldset className={`segmented-control${size === 'sm' ? ' is-sm' : ''}${className ? ` ${className}` : ''}`} disabled={disabled} style={style}>
    <legend className="sr-only">{label}</legend>
    {showLabel && <span aria-hidden="true" className="field-label">{label}</span>}
    <div className="segmented-track">
      {options.map((option) => <label key={option.value}>
        <input type="radio" name={name ?? generated} value={option.value} disabled={option.disabled}
          checked={value === undefined ? undefined : value === option.value}
          defaultChecked={value === undefined ? (defaultValue ?? options[0]?.value) === option.value : undefined}
          onChange={()=>onValueChange?.(option.value)} />
        <span>{option.label}</span>
      </label>)}
    </div>
  </fieldset>;
}
