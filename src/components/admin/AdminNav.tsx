'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import type { UserRole } from '@/lib/auth/authorization';
import type { AdminOverview } from '@/lib/admin/overview';
import Icon, { type IconName } from '@/components/ui/Icon';
import { zhCN } from '@/messages/zh-CN';

type Module = readonly [href: string, label: string, minimum: 'moderator' | 'admin', icon: IconName, badge?: keyof AdminOverview];

/** 模块顺序即工作顺序：先处理待办（审核 / 评论 / 举报），再是内容与账号管理，最后是记录与系统。 */
const modules: readonly Module[] = [
  ['/admin/reviews', zhCN.communityAdmin.nav.reviews, 'moderator', 'inbox', 'pendingRevisions'],
  ['/admin/comments', zhCN.communityAdmin.nav.comments, 'moderator', 'send', 'pendingComments'],
  ['/admin/reports', zhCN.communityAdmin.nav.reports, 'moderator', 'flag', 'openReports'],
  ['/admin/works', zhCN.communityAdmin.nav.works, 'moderator', 'images'],
  ['/admin/tags', zhCN.communityAdmin.nav.tags, 'moderator', 'tag'],
  ['/admin/batches', zhCN.communityAdmin.nav.batches, 'admin', 'grid'],
  ['/admin/users', zhCN.communityAdmin.nav.users, 'admin', 'users'],
  ['/admin/analytics', zhCN.communityAdmin.nav.analytics, 'admin', 'chart'],
  ['/admin/audit', zhCN.communityAdmin.nav.audit, 'admin', 'list'],
  ['/admin/system', zhCN.communityAdmin.nav.system, 'admin', 'shield'],
];

export default function AdminNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const menuId = useId();
  const visible = modules.filter(([, , minimum]) => role === 'admin' || minimum === 'moderator');
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const currentLabel = visible.find(([href]) => isCurrent(href))?.[1] ?? zhCN.communityAdmin.nav.overview;
  useEffect(() => {
    const controller = new AbortController();
    // 角标只是提示，读不到就不显示；不阻塞导航，也不重试。
    fetch('/api/admin/overview', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data && typeof data === 'object') setOverview(data as AdminOverview); })
      .catch(() => {});
    return () => controller.abort();
  }, [pathname]);
  const badgeFor = (key?: keyof AdminOverview) => {
    if (!key || !overview) return null;
    const value = overview[key];
    if (typeof value !== 'number' || value <= 0) return null;
    return <span className="admin-nav-badge" aria-label={zhCN.communityAdmin.nav.pendingCount(value)}>{value > 99 ? '99+' : value}</span>;
  };
  return (
    <aside aria-label={zhCN.communityAdmin.nav.label} className={`admin-rail${expanded ? ' is-expanded' : ''}`} onKeyDown={(event) => { if (event.key === 'Escape') { setExpanded(false); document.getElementById(`${menuId}-toggle`)?.focus(); } }}>
      <Link href="/admin" className="admin-wordmark" aria-current={pathname === '/admin' ? 'page' : undefined}><span aria-hidden="true">{zhCN.communityAdmin.nav.wordmark}</span><strong>{zhCN.communityAdmin.adminTitle}</strong></Link>
      <button type="button" className="admin-mobile-menu" id={`${menuId}-toggle`} aria-expanded={expanded} aria-controls={menuId} onClick={() => setExpanded(!expanded)}>
        <span>{currentLabel}</span><Icon name={expanded ? 'chevron-down' : 'chevron-up'} size={18} /><span className="sr-only">{expanded ? zhCN.communityAdmin.nav.closeMenu : zhCN.communityAdmin.nav.openMenu}</span>
      </button>
      <nav id={menuId} aria-label={zhCN.communityAdmin.nav.label}>
        <Link href="/admin" aria-current={pathname === '/admin' ? 'page' : undefined} onClick={() => setExpanded(false)}><Icon name="home" size={18} />{zhCN.communityAdmin.nav.overview}</Link>
        {visible.map(([href, label, , icon, badge]) => <Link key={href} href={href} aria-current={isCurrent(href) ? 'page' : undefined} onClick={() => setExpanded(false)}><Icon name={icon} size={18} />{label}{badgeFor(badge)}</Link>)}
      </nav>
      <Link href="/" className="admin-back"><Icon name="log-out" size={16} />{zhCN.communityAdmin.nav.back}</Link>
    </aside>
  );
}
