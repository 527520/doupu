import { forbidden } from 'next/navigation';
import RulesEditor from '@/components/admin/RulesEditor';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';

export default async function AdminRulesPage() {
  if (!authorize(await getSessionActor(), 'moderation-rules:manage')) forbidden();
  return <main className="admin-page"><header className="admin-page-header"><span>08 / RULE VERSIONS</span><h1>审核规则</h1><p>只接受字面词与明确分类；不接受正则，也不维护政治词库。</p></header><RulesEditor /></main>;
}
