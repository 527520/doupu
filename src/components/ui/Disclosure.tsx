'use client';

/**
 * 样式化折叠（site-ui-overhaul 02）：替代全站 17 处裸 `<details>/<summary>`。
 * 触发器是真正的按钮（aria-expanded / aria-controls 由 react-aria 生成），
 * 右侧 chevron 随展开旋转；面板 220ms 展开，减少动态时关闭。
 * 未水合（含无 JS）时渲染原生 <details>，保证 GET 表单里的筛选字段仍可展开、提交。
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { Button, Disclosure as AriaDisclosure, DisclosurePanel } from 'react-aria-components';
import Icon, { type IconName } from './Icon';

export interface DisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  /** 摘要右侧的次要信息（数量、当前值）。 */
  meta?: ReactNode;
  icon?: IconName;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
  /** 面板内边距收紧，用于嵌在卡片里。 */
  compact?: boolean;
  id?: string;
}

const subscribeHydration = () => () => {};

export default function Disclosure({ summary, children, meta, icon, defaultExpanded, expanded, onExpandedChange, className = '', compact = false, id }: DisclosureProps) {
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const classes = `disclosure${compact ? ' is-compact' : ''} ${className}`;
  const label = <>
    {icon && <Icon name={icon} size={18} className="disclosure-icon" />}
    <span className="disclosure-summary">{summary}</span>
    {meta !== undefined && <span className="disclosure-meta">{meta}</span>}
    <Icon name="chevron-down" size={18} className="disclosure-chevron" />
  </>;
  if (!hydrated) {
    return <details id={id} className={`${classes} is-native`} open={expanded ?? defaultExpanded ?? undefined}>
      <summary className="disclosure-trigger">{label}</summary>
      <div className="disclosure-panel"><div className="disclosure-body">{children}</div></div>
    </details>;
  }
  return <AriaDisclosure id={id} defaultExpanded={defaultExpanded} isExpanded={expanded} onExpandedChange={onExpandedChange} className={classes}>
    <Button slot="trigger" className="disclosure-trigger">{label}</Button>
    <DisclosurePanel className="disclosure-panel"><div className="disclosure-body">{children}</div></DisclosurePanel>
  </AriaDisclosure>;
}
