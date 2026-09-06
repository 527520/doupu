'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';

export interface TagSuggestion { id: string; name: string; count?: number }

interface Props {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** 联想来源；返回匹配当前输入的候选。缺省时只允许自由输入。 */
  suggest?: (query: string, signal: AbortSignal) => Promise<TagSuggestion[]>;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  describedBy?: string;
}

const normalize = (raw: string) => raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();

/**
 * 标签输入框：芯片 + 文本输入。回车 / 逗号 / 顿号加入，退格删除末尾，
 * 输入时联想已有标签；未匹配的名称按原样加入（服务端现打现建）。
 */
export default function TagInput({ label, value, onChange, suggest, max = 10, disabled, placeholder, describedBy }: Props) {
  const t = zhCN.tagInput;
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const full = value.length >= max;

  useEffect(() => {
    if (!suggest || !open) return;
    const query = normalize(draft);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      suggest(query, controller.signal)
        .then((items) => { if (!controller.signal.aborted) setSuggestions(items.filter((item) => !value.some((name) => name.toLocaleLowerCase('zh-CN') === item.name.toLocaleLowerCase('zh-CN'))).slice(0, 8)); })
        .catch(() => { if (!controller.signal.aborted) setSuggestions([]); });
    }, 150);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [draft, open, suggest, value]);
  const visibleSuggestions = open && suggest ? suggestions : [];

  const add = (raw: string) => {
    const name = normalize(raw);
    if (!name || full) return;
    if (value.some((existing) => existing.toLocaleLowerCase('zh-CN') === name.toLocaleLowerCase('zh-CN'))) { setDraft(''); return; }
    onChange([...value, name.slice(0, 30)]);
    setDraft(''); setActive(-1);
  };
  const remove = (index: number) => { if (!disabled) onChange(value.filter((_, i) => i !== index)); };

  return (
    <div className="tag-input" data-disabled={disabled ? 'true' : undefined} onClick={() => inputRef.current?.focus()}>
      <span className="tag-input-label" id={`${listId}-label`}>{label}</span>
      <div className="tag-input-field" role="group" aria-labelledby={`${listId}-label`}>
        {value.map((name, index) => (
          <span key={name} className="tag-chip">
            {name}
            <button type="button" aria-label={t.remove(name)} disabled={disabled} onClick={(event) => { event.stopPropagation(); remove(index); }}>×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-input-text"
          value={draft}
          disabled={disabled || full}
          placeholder={full ? t.full(max) : placeholder ?? t.placeholder}
          aria-describedby={describedBy}
          aria-autocomplete="list"
          aria-controls={visibleSuggestions.length ? `${listId}-list` : undefined}
          aria-expanded={visibleSuggestions.length > 0}
          role="combobox"
          onFocus={() => setOpen(true)}
          onBlur={() => { window.setTimeout(() => { setOpen(false); setSuggestions([]); }, 120); }}
          onChange={(event) => { setDraft(event.target.value); setActive(-1); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',' || event.key === '，' || event.key === '、') {
              event.preventDefault();
              if (active >= 0 && visibleSuggestions[active]) add(visibleSuggestions[active].name); else add(draft);
            } else if (event.key === 'Backspace' && !draft && value.length) {
              remove(value.length - 1);
            } else if (event.key === 'ArrowDown' && visibleSuggestions.length) {
              event.preventDefault(); setActive((current) => (current + 1) % visibleSuggestions.length);
            } else if (event.key === 'ArrowUp' && visibleSuggestions.length) {
              event.preventDefault(); setActive((current) => (current <= 0 ? visibleSuggestions.length - 1 : current - 1));
            } else if (event.key === 'Escape') { setOpen(false); setSuggestions([]); }
          }}
        />
      </div>
      {visibleSuggestions.length > 0 && (
        <ul className="tag-input-suggestions" id={`${listId}-list`} role="listbox">
          {visibleSuggestions.map((item, index) => (
            <li key={item.id} role="option" aria-selected={index === active}>
              <button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => add(item.name)}>
                {item.name}{typeof item.count === 'number' && <small>{t.usage(item.count)}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="tag-input-help">{t.help(max)}</p>
    </div>
  );
}
