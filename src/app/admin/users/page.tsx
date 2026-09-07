import { forbidden } from 'next/navigation';
import UsersManager from '@/components/admin/UsersManager';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminUsersPage() {
  const actor = await getSessionActor();
  if (!actor || !authorize(actor, 'users:manage')) forbidden();
  const t = zhCN.communityAdmin.pages.users;
  return <main id="main" className="admin-page"><AdminPageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} /><UsersManager currentUserId={actor.userId} /></main>;
}
