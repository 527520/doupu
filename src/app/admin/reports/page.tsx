import { forbidden } from 'next/navigation';
import GovernanceConsole from '@/components/admin/GovernanceConsole';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminReportsPage() {
  if (!authorize(await getSessionActor(), 'community:moderate')) forbidden();
  const t = zhCN.communityAdmin.pages.reports;
  return <main id="main" className="admin-page"><AdminPageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} /><GovernanceConsole mode="reports" /></main>;
}
