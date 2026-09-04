import GovernanceConsole from '@/components/admin/GovernanceConsole';

export default function AdminCommentsPage() {
  return <main className="admin-page"><header className="admin-page-header"><span>02 / COMMENT PROOF</span><h1>评论治理</h1><p>高风险评论先进入待审；治理结论不自动触发封号。</p></header><GovernanceConsole mode="comments" /></main>;
}
