import { forbidden } from 'next/navigation';
import OfficialBatchStudio from '@/components/admin/OfficialBatchStudio';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminBatchesPage() {
  if (!authorize(await getSessionActor(), 'official:manage')) forbidden();
  const t = zhCN.communityAdmin.pages.batches;
  return <main id="main" className="admin-page"><header className="admin-page-header"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></header><OfficialBatchStudio /></main>;
}
