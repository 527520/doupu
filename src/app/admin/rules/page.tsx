import { forbidden } from 'next/navigation';
import RulesEditor from '@/components/admin/RulesEditor';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminRulesPage() {
  if (!authorize(await getSessionActor(), 'moderation-rules:manage')) forbidden();
  const t = zhCN.communityAdmin.pages.rules;
  return <main className="admin-page"><header className="admin-page-header"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></header><RulesEditor /></main>;
}
