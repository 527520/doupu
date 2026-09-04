import Link from 'next/link';

const modules = [
  ['/admin/reviews', '作品审核'],
  ['/admin/comments', '评论治理'],
  ['/admin/reports', '举报案件'],
  ['/admin/tags', '正式标签'],
  ['/admin/analytics', '匿名分析'],
  ['/admin/batches', '官方批次'],
  ['/admin/users', '人员管理'],
  ['/admin/rules', '审核规则'],
  ['/admin/audit', '审计记录'],
  ['/admin/system', '系统信息'],
] as const;

export default function AdminNav() {
  return (
    <aside className="admin-rail">
      <Link href="/admin" className="admin-wordmark"><span>DP</span><strong>审核校样台</strong></Link>
      <nav aria-label="管理模块">
        {modules.map(([href, label], index) => <Link key={href} href={href}><small>{String(index + 1).padStart(2, '0')}</small>{label}</Link>)}
      </nav>
      <Link href="/" className="admin-back">返回豆谱</Link>
    </aside>
  );
}
