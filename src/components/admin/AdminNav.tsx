'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState } from 'react';
import type { UserRole } from '@/lib/auth/authorization';
import { zhCN } from '@/messages/zh-CN';

const modules = [
  ['/admin/reviews', zhCN.communityAdmin.nav.reviews, 'moderator'],
  ['/admin/works', zhCN.communityAdmin.nav.works, 'moderator'],
  ['/admin/comments', zhCN.communityAdmin.nav.comments, 'moderator'],
  ['/admin/reports', zhCN.communityAdmin.nav.reports, 'moderator'],
  ['/admin/tags', zhCN.communityAdmin.nav.tags, 'moderator'],
  ['/admin/analytics', zhCN.communityAdmin.nav.analytics, 'admin'],
  ['/admin/batches', zhCN.communityAdmin.nav.batches, 'admin'],
  ['/admin/users', zhCN.communityAdmin.nav.users, 'admin'],
  ['/admin/rules', zhCN.communityAdmin.nav.rules, 'admin'],
  ['/admin/audit', zhCN.communityAdmin.nav.audit, 'admin'],
  ['/admin/system', zhCN.communityAdmin.nav.system, 'admin'],
] as const;

export default function AdminNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const menuId = useId();
  const visible = modules.filter(([, , minimum]) => role === 'admin' || minimum === 'moderator');
  const currentLabel = visible.find(([href]) => pathname === href || pathname.startsWith(`${href}/`))?.[1] ?? zhCN.communityAdmin.adminTitle;
  return (
    <aside className={`admin-rail${expanded ? ' is-expanded' : ''}`} onKeyDown={(event) => { if (event.key === 'Escape') { setExpanded(false); document.getElementById(`${menuId}-toggle`)?.focus(); } }}>
      <Link href="/admin" className="admin-wordmark"><span>{zhCN.communityAdmin.nav.wordmark}</span><strong>{zhCN.communityAdmin.adminTitle}</strong></Link>
      <button type="button" className="admin-mobile-menu" id={`${menuId}-toggle`} aria-expanded={expanded} aria-controls={menuId} onClick={() => setExpanded(!expanded)}>{currentLabel} · {expanded ? zhCN.communityAdmin.nav.closeMenu : zhCN.communityAdmin.nav.openMenu}</button>
      <nav id={menuId} aria-label={zhCN.communityAdmin.nav.label}>
        {visible.map(([href, label], index) => <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined} onClick={() => setExpanded(false)}><small aria-hidden="true">{String(index + 1).padStart(2, '0')}</small>{label}</Link>)}
      </nav>
      <Link href="/" className="admin-back">{zhCN.communityAdmin.nav.back}</Link>
    </aside>
  );
}
