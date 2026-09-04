import { forbidden } from 'next/navigation';
import { getDb } from '@/lib/auth/db';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { listAdminAudit } from '@/lib/admin/queries';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminAuditPage() {
  if (!authorize(await getSessionActor(), 'audit:read')) forbidden();
  const items = await listAdminAudit(getDb());
  const t = zhCN.communityAdmin.pages.audit;
  const columns = zhCN.communityAdmin.audit;
  return <main className="admin-page"><header className="admin-page-header"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></header><section className="admin-panel"><div className="admin-table-scroll"><table><thead><tr><th>{columns.time}</th><th>{columns.action}</th><th>{columns.target}</th><th>{columns.role}</th><th>{columns.reason}</th><th>{columns.request}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(item.createdAt))}</td><td><code>{item.action}</code></td><td><span>{item.targetType}</span><small className="mono-id">{item.targetId}</small></td><td>{item.actorRole}</td><td>{item.reason}</td><td><small className="mono-id">{item.requestId}</small></td></tr>)}</tbody></table></div></section></main>;
}
