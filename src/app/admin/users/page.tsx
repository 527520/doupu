import { forbidden } from 'next/navigation';
import UsersManager from '@/components/admin/UsersManager';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';

export default async function AdminUsersPage() {
  if (!authorize(await getSessionActor(), 'users:manage')) forbidden();
  return <main className="admin-page"><header className="admin-page-header"><span>07 / PEOPLE</span><h1>人员管理</h1><p>角色与暂停操作撤销全部会话；不能修改自身角色、暂停自身或移除最后一名有效管理员。</p></header><UsersManager /></main>;
}
