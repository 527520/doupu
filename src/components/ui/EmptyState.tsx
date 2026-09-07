/**
 * 空态（site-ui-overhaul 02）：钉板纹理上放一句邀请，而不是一行灰字。
 * 说清「这里会出现什么」和「下一步做什么」，可选一个动作。
 */
import type { ReactNode } from 'react';
import Icon, { type IconName } from './Icon';

export default function EmptyState({ title, description, action, icon = 'grid', compact = false, className = '', role }: {
  title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: IconName; compact?: boolean; className?: string; role?: 'status';
}) {
  return <div role={role} className={`empty-state pegboard${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}>
    <span className="empty-state-icon" aria-hidden="true"><Icon name={icon} size={compact ? 20 : 26} /></span>
    <p className="empty-state-title">{title}</p>
    {description && <p className="empty-state-description">{description}</p>}
    {action && <div className="empty-state-action">{action}</div>}
  </div>;
}
