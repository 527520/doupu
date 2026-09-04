import { forbidden } from 'next/navigation';
import UsersManager from '@/components/admin/UsersManager';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminUsersPage() {
  if (!authorize(await getSessionActor(), 'users:manage')) forbidden();
  const t = zhCN.communityAdmin.pages.users;
  return <main className="admin-page"><header className="admin-page-header"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></header><UsersManager /></main>;
}
