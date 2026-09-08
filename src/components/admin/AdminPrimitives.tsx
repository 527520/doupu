'use client';

/**
 * 后台共享组件（site-ui-overhaul 06）。此前分页、筛选条、状态徽标、理由 + 确认区都是各 Manager 内联的 JSX，
 * 九个模块九种写法。这里把它们收成小组件，样式仍走 globals.css 的 .admin-* 类。
 */
import type { FormEvent, ReactNode } from 'react';
import Badge, { type BadgeTone } from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import EmptyState from '@/components/ui/EmptyState';
import Textarea from '@/components/ui/Textarea';
import type { IconName } from '@/components/ui/Icon';
import { zhCN } from '@/messages/zh-CN';

const states = zhCN.communityAdmin.states;

/** 列表 + 详情双栏；`inspecting` 时窄屏只显示详情。 */
export function ListDetailLayout({ queue, detail, notice, inspecting = false, className = '' }: {
  queue: ReactNode; detail: ReactNode; notice?: ReactNode; inspecting?: boolean; className?: string;
}) {
  return <div className={`admin-task-layout${inspecting ? ' is-inspecting' : ''}${className ? ` ${className}` : ''}`}>
    {queue}{detail}
    {notice !== undefined && <div className="admin-task-notice">{notice}</div>}
  </div>;
}

export function Pagination({ page, hasPrevious, hasNext, onPrevious, onNext, disabled = false }: {
  page?: number; hasPrevious: boolean; hasNext: boolean; onPrevious: () => void; onNext: () => void; disabled?: boolean;
}) {
  const t = zhCN.communityAdmin.works;
  return <nav className="admin-pagination" aria-label={t.pagination}>
    <Button variant="secondary" size="sm" icon="chevron-left" disabled={disabled || !hasPrevious} onClick={onPrevious}>{t.previous}</Button>
    {page !== undefined && <span className="admin-pagination-page">{t.page(page)}</span>}
    <Button variant="secondary" size="sm" icon="chevron-right" iconPosition="end" disabled={disabled || !hasNext} onClick={onNext}>{t.next}</Button>
  </nav>;
}

/**
 * 筛选条：字段与查询按钮在同一行（.form-row 让所有控件底边对齐），按钮靠行尾；提交交给调用方。
 * 字段请用 TextField / ResponsiveSelect / DatePicker——它们的标签都锁高且不换行，同行才对得齐。
 */
export function FilterBar({ children, onSubmit, submitLabel, disabled = false, extra, className = '' }: {
  children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitLabel: string; disabled?: boolean; extra?: ReactNode; className?: string;
}) {
  return <form className={`admin-filter-bar form-row${className ? ` ${className}` : ''}`} onSubmit={onSubmit}>
    {children}
    <div className="form-row-actions">{extra}<Button type="submit" variant="secondary" icon="search" disabled={disabled}>{submitLabel}</Button></div>
  </form>;
}

type StateKind = keyof typeof states;
const TONES: Record<string, BadgeTone> = {
  active: 'ok', published: 'ok', resolved: 'ok', admin: 'progress', moderator: 'progress',
  pending_review: 'warn', open: 'warn', accepted: 'progress', draft: 'neutral', superseded: 'neutral', user: 'neutral',
  rejected: 'danger', removed: 'danger', hidden: 'danger', suspended: 'danger', withdrawn: 'neutral', deleted: 'neutral', anonymized: 'neutral', dismissed: 'neutral',
};

/** 状态徽标：一律走 `states.*` 中文映射，未知值原样展示（不遮盖新事实）。 */
export function StatusBadge({ kind, value, className }: { kind: StateKind; value: string; className?: string }) {
  const map = states[kind] as Record<string, string>;
  return <Badge tone={TONES[value] ?? 'neutral'} className={className}>{map[value] ?? value}</Badge>;
}

/**
 * 理由 + 确认区：所有管理写入都要填理由（≥3 字）；破坏性动作再加一句确认。
 * 动作按钮由调用方传入，这里只负责把「为什么」和「我确认」摆在动作旁边。
 */
export function ReasonPanel({ reason, onReasonChange, label, placeholder, disabled = false, confirm, fields, children, hint }: {
  reason: string; onReasonChange: (value: string) => void; label?: string; placeholder?: string; disabled?: boolean;
  confirm?: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; danger?: boolean };
  /** 动作之前的附加字段（确认编号、目标角色…）：独立成行，不与按钮同排。 */
  fields?: ReactNode;
  children?: ReactNode; hint?: ReactNode;
}) {
  const t = zhCN.communityAdmin.command;
  const tooShort = reason.trim().length > 0 && reason.trim().length < 3;
  return <div className={`admin-reason-panel${confirm?.danger ? ' is-danger' : ''}`}>
    <Textarea label={label ?? t.reason} value={reason} maxLength={500} rows={3} disabled={disabled} placeholder={placeholder ?? t.reasonPlaceholder}
      onValueChange={onReasonChange} error={tooShort ? t.reasonTooShort : undefined} hint={tooShort ? undefined : hint} />
    {confirm && <Checkbox label={confirm.label} checked={confirm.checked} disabled={disabled} onChange={confirm.onChange} className="admin-reason-confirm" />}
    {fields}
    {children && <div className="admin-reason-actions">{children}</div>}
  </div>;
}

/** 面板里的空态：靠顶排布，紧挨着它指向的列表；`align="center"` 只给整块独立的空面板。 */
export function AdminEmpty({ title, description, icon = 'inbox', action, align = 'start' }: { title: ReactNode; description?: ReactNode; icon?: IconName; action?: ReactNode; align?: 'start' | 'center' }) {
  return <EmptyState compact icon={icon} title={title} description={description} action={action} align={align} className="admin-empty-state" />;
}

/** 列表加载中的骨架：三行占位，读屏只播一句「正在读取」。 */
export function AdminSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return <div className="skeleton-list" role="status" aria-label={label}>
    {Array.from({ length: rows }, (_, index) => <i key={index} className="skeleton" aria-hidden="true" />)}
  </div>;
}
