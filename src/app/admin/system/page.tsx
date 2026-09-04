import { forbidden } from 'next/navigation';
import { getDb } from '@/lib/auth/db';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { getSystemInfo } from '@/lib/admin/queries';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminSystemPage() {
  if (!authorize(await getSessionActor(), 'system:read')) forbidden();
  const info = await getSystemInfo(getDb());
  const t = zhCN.communityAdmin.system;
  return <main className="admin-page"><header className="admin-page-header"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></header><section className="admin-metrics"><article><small>{t.appCode}</small><strong>{info.applicationVersion}</strong><span>{t.app}</span></article><article><small>{t.journalCode}</small><strong>{t.local.toUpperCase()}</strong><span>{info.migrationJournalLatest ?? zhCN.communityAdmin.unavailable}</span></article><article><small>{t.databaseCode}</small><strong>{info.databaseMigration.id ?? t.empty}</strong><span>{info.databaseMigration.appliedAt ?? zhCN.communityAdmin.unavailable}</span></article><article><small>{t.backupCode}</small><strong>{t.backup}</strong><span>{t.backupDetail}</span></article></section><section className="admin-panel"><header><h2>{t.maintenance}</h2><span>{info.maintenance.length}</span></header><table><thead><tr><th>{t.task}</th><th>{t.status}</th><th>{t.started}</th><th>{t.errorCode}</th></tr></thead><tbody>{info.maintenance.map((run, index) => <tr key={`${run.task}:${run.startedAt}:${index}`}><td>{run.task}</td><td>{run.status}</td><td>{run.startedAt}</td><td>{run.errorCode ?? t.empty}</td></tr>)}</tbody></table></section></main>;
}
