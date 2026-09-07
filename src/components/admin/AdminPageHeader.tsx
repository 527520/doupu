/**
 * 后台页头（site-ui-overhaul 06）：眉题在上、标题居左、说明在下、动作靠右。
 * 之前 header 是一行 flex，眉题 / 标题 / 说明三个兄弟被横向撑开，标题在窄栏里被挤成两行。
 */
import type { ReactNode } from 'react';

export default function AdminPageHeader({ eyebrow, title, description, actions, className = '' }: {
  eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return <header className={`admin-page-header${className ? ` ${className}` : ''}`}>
    <div className="admin-page-heading">
      {eyebrow && <span className="admin-page-eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="admin-page-actions">{actions}</div>}
  </header>;
}
