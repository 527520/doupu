import { forbidden } from 'next/navigation';
import ReviewConsole from '@/components/admin/ReviewConsole';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { zhCN } from '@/messages/zh-CN';

export default async function ReviewsPage() {
  if (!authorize(await getSessionActor(), 'community:moderate')) forbidden();
  const t = zhCN.communityAdmin.pages.reviews;
  return <main id="main" className="admin-page"><AdminPageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} /><ReviewConsole /></main>;
}
