import { forbidden } from 'next/navigation';
import { getDb } from '@/lib/auth/db';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { getSystemInfo } from '@/lib/admin/queries';

export default async function AdminSystemPage() {
  if (!authorize(await getSessionActor(), 'system:read')) forbidden();
  const info = await getSystemInfo(getDb());
  return <main className="admin-page"><header className="admin-page-header"><span>10 / RUNTIME</span><h1>系统信息</h1><p>只读运行证据；未接入的信息会明确标记，不推断为正常。</p></header><section className="admin-metrics"><article><small>APP</small><strong>{info.applicationVersion}</strong><span>应用版本</span></article><article><small>JOURNAL</small><strong>LOCAL</strong><span>{info.migrationJournalLatest ?? '无法读取'}</span></article><article><small>DATABASE</small><strong>{info.databaseMigration.id ?? '—'}</strong><span>{info.databaseMigration.appliedAt ?? '无法读取'}</span></article><article><small>BACKUP</small><strong>未接入</strong><span>容器状态未安全共享</span></article></section><section className="admin-panel"><header><h2>维护任务</h2><span>{info.maintenance.length}</span></header><table><thead><tr><th>任务</th><th>状态</th><th>开始</th><th>错误码</th></tr></thead><tbody>{info.maintenance.map((run, index) => <tr key={`${run.task}:${run.startedAt}:${index}`}><td>{run.task}</td><td>{run.status}</td><td>{run.startedAt}</td><td>{run.errorCode ?? '—'}</td></tr>)}</tbody></table></section></main>;
}
