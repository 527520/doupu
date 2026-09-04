import { forbidden } from 'next/navigation';
import ReviewConsole from '@/components/admin/ReviewConsole';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { zhCN } from '@/messages/zh-CN';

export default async function ReviewsPage() {
  if (!authorize(await getSessionActor(), 'community:moderate')) forbidden();
  const t = zhCN.communityAdmin.pages.reviews;
  return <main id="main" className="admin-page"><header className="admin-page-header"><div><span>{t.eyebrow}</span><h1>{t.title}</h1></div><p>{t.description}</p></header><ReviewConsole /></main>;
}
