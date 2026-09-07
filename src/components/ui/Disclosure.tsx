'use client';

/**
 * 样式化折叠（site-ui-overhaul 02）：替代全站 17 处裸 `<details>/<summary>`。
 * 触发器是真正的按钮（aria-expanded / aria-controls 由 react-aria 生成），
 * 右侧 chevron 随展开旋转；面板 220ms 展开，减少动态时关闭。
 */
import type { ReactNode } from 'react';
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

export default function Disclosure({ summary, children, meta, icon, defaultExpanded, expanded, onExpandedChange, className = '', compact = false, id }: DisclosureProps) {
  return <AriaDisclosure id={id} defaultExpanded={defaultExpanded} isExpanded={expanded} onExpandedChange={onExpandedChange} className={`disclosure${compact ? ' is-compact' : ''} ${className}`}>
    <Button slot="trigger" className="disclosure-trigger">
      {icon && <Icon name={icon} size={18} className="disclosure-icon" />}
      <span className="disclosure-summary">{summary}</span>
      {meta !== undefined && <span className="disclosure-meta">{meta}</span>}
      <Icon name="chevron-down" size={18} className="disclosure-chevron" />
    </Button>
    <DisclosurePanel className="disclosure-panel"><div className="disclosure-body">{children}</div></DisclosurePanel>
  </AriaDisclosure>;
}
