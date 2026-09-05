import { forbidden } from 'next/navigation';
import TagsManager from '@/components/admin/TagsManager';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminTagsPage() {
  if (!authorize(await getSessionActor(), 'community:moderate')) forbidden();
  const t = zhCN.communityAdmin.pages.tags;
  return <main id="main" className="admin-page"><header className="admin-page-header"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></header><TagsManager /></main>;
}
