import { forbidden } from 'next/navigation';
import { getDb } from '@/lib/auth/db';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { listAdminAudit } from '@/lib/admin/queries';

export default async function AdminAuditPage() {
  if (!authorize(await getSessionActor(), 'audit:read')) forbidden();
  const items = await listAdminAudit(getDb());
  return <main className="admin-page"><header className="admin-page-header"><span>09 / APPEND-ONLY</span><h1>审计记录</h1><p>仅显示白名单状态，不保存令牌、完整邮箱、密码或正文。</p></header><section className="admin-panel"><div className="admin-table-scroll"><table><thead><tr><th>时间</th><th>动作</th><th>目标</th><th>角色</th><th>理由</th><th>请求</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(item.createdAt))}</td><td><code>{item.action}</code></td><td><span>{item.targetType}</span><small className="mono-id">{item.targetId}</small></td><td>{item.actorRole}</td><td>{item.reason}</td><td><small className="mono-id">{item.requestId}</small></td></tr>)}</tbody></table></div></section></main>;
}
