'use client';

/**
 * 单行文本字段（ui-polish-2026）：标签 + 输入框，走全站统一的字段配方。
 *
 * 之前后台筛选条、确认框、批次标题等处各写一套 `<label>文字<input/></label>`，
 * 标签是裸文本节点，既锁不了高也换不了行策略，一换行同排字段就错位。
 * 这里把标签包成 `.field-label`（锁高 1.25rem、筛选行内不换行），输入走 `.field-input`。
 */
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'> {
  label: ReactNode;
  hideLabel?: boolean;
  /** 尺寸档：md = 44（表单行），sm = 36（工具行）。 */
  size?: 'md' | 'sm';
  /** 等宽字体（编号、颜色值）。 */
  mono?: boolean;
  description?: ReactNode;
  error?: string;
  className?: string;
  inputClassName?: string;
}

export default function TextField({ label, hideLabel = false, size = 'md', mono = false, description, error, className = '', inputClassName = '', id, title, ...rest }: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = description || error ? `${fieldId}-hint` : undefined;
  const labelText = typeof label === 'string' ? label : undefined;
  return <div className={`field${className ? ` ${className}` : ''}`}>
    <label htmlFor={fieldId} className={hideLabel ? 'sr-only' : 'field-label'} title={title ?? labelText}>{label}</label>
    <input id={fieldId} aria-describedby={describedBy} aria-invalid={error ? true : undefined}
      className={`${size === 'sm' ? 'input-compact' : 'field-input'}${mono ? ' is-mono' : ''}${inputClassName ? ` ${inputClassName}` : ''}`} {...rest} />
    {(description || error) && <span id={describedBy} className={error ? 'field-error' : 'field-description'}>{error ?? description}</span>}
  </div>;
}
