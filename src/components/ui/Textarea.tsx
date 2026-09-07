'use client';

/**
 * 多行文本（site-ui-overhaul 02）：自带字数计数与错误提示，替代评论、理由、举报说明处各写一套。
 */
import { useId, type ReactNode, type TextareaHTMLAttributes } from 'react';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  maxLength?: number;
  hideLabel?: boolean;
  error?: string;
  hint?: ReactNode;
  /** 计数右侧的动作（例如「发布评论」按钮）。 */
  actions?: ReactNode;
}

export default function Textarea({ label, value, onValueChange, maxLength, hideLabel = false, error, hint, actions, id, className = '', ...rest }: TextareaProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = `${fieldId}-hint`;
  return <div className={`textarea-field${className ? ` ${className}` : ''}`}>
    <label htmlFor={fieldId} className={hideLabel ? 'sr-only' : 'textarea-label'}>{label}</label>
    <textarea id={fieldId} value={value} maxLength={maxLength} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? hintId : undefined}
      onChange={(event) => onValueChange(event.target.value)} className="textarea-input" {...rest} />
    <div className="textarea-foot">
      <span id={hintId} className={error ? 'textarea-error' : 'textarea-hint'}>{error ?? hint}</span>
      <span className="textarea-count" aria-live="polite">{maxLength !== undefined && <small>{value.length}/{maxLength}</small>}{actions}</span>
    </div>
  </div>;
}
