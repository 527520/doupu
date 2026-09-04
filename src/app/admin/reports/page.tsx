import { forbidden } from 'next/navigation';
import GovernanceConsole from '@/components/admin/GovernanceConsole';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminReportsPage() {
  if (!authorize(await getSessionActor(), 'community:moderate')) forbidden();
  const t = zhCN.communityAdmin.pages.reports;
  return <main className="admin-page"><header className="admin-page-header"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></header><GovernanceConsole mode="reports" /></main>;
}
