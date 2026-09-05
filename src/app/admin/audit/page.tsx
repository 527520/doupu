import { forbidden } from 'next/navigation';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import AuditExplorer from '@/components/admin/AuditExplorer';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminAuditPage() {
  if (!authorize(await getSessionActor(), 'audit:read')) forbidden();
  const t = zhCN.communityAdmin.pages.audit;
  return <main id="main" className="admin-page"><header className="admin-page-header"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></header><AuditExplorer /></main>;
}
