import Link from 'next/link';
import type { UserRole } from '@/lib/auth/authorization';

const modules = [
  ['/admin/reviews', '作品审核', 'moderator'],
  ['/admin/comments', '评论治理', 'moderator'],
  ['/admin/reports', '举报案件', 'moderator'],
  ['/admin/tags', '正式标签', 'moderator'],
  ['/admin/analytics', '匿名分析', 'admin'],
  ['/admin/batches', '官方批次', 'admin'],
  ['/admin/users', '人员管理', 'admin'],
  ['/admin/rules', '审核规则', 'admin'],
  ['/admin/audit', '审计记录', 'admin'],
  ['/admin/system', '系统信息', 'admin'],
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
