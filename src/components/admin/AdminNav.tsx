import Link from 'next/link';
import type { UserRole } from '@/lib/auth/authorization';
import { zhCN } from '@/messages/zh-CN';

const modules = [
  ['/admin/reviews', zhCN.communityAdmin.nav.reviews, 'moderator'],
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
  const visible = modules.filter(([, , minimum]) => role === 'admin' || minimum === 'moderator');
  return (
    <aside className="admin-rail">
      <Link href="/admin" className="admin-wordmark"><span>DP</span><strong>审核校样台</strong></Link>
      <nav aria-label="管理模块">
        {visible.map(([href, label], index) => <Link key={href} href={href}><small>{String(index + 1).padStart(2, '0')}</small>{label}</Link>)}
      </nav>
      <Link href="/" className="admin-back">返回豆谱</Link>
    </aside>
  );
}
