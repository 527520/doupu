import GovernanceConsole from '@/components/admin/GovernanceConsole';

export default function AdminReportsPage() {
  return <main className="admin-page"><header className="admin-page-header"><span>03 / REPORT CASES</span><h1>举报案件</h1><p>按目标版本去重；每次受理、结案或驳回都要求理由。</p></header><GovernanceConsole mode="reports" /></main>;
}
