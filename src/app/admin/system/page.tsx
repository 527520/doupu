import { forbidden } from 'next/navigation';
import { getDb } from '@/lib/auth/db';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { getSystemInfo } from '@/lib/admin/queries';
import { summarizeModerationToday } from '@/lib/moderation/commentModeration';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminSystemPage() {
  if (!authorize(await getSessionActor(), 'system:read')) forbidden();
  const [info, moderation] = await Promise.all([getSystemInfo(getDb()), summarizeModerationToday(getDb())]);
  const t = zhCN.communityAdmin.system;
  const m = zhCN.communityAdmin.moderationHealth;
  const taskLabel = (task: string) => t.tasks[task as keyof typeof t.tasks] ?? task;
  const date = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Shanghai' }).format(new Date(value)) : t.notRecorded;
  const degraded = !moderation.enabled || moderation.health.consecutiveFailures > 0 || moderation.calls >= moderation.budget;
  return <main id="main" className="admin-page admin-system-page">
    <header className="admin-page-header"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></header>
    <section className="admin-panel" aria-label={m.title}>
      <header><h2>{m.title}</h2><span className={`admin-run-state ${degraded ? 'is-failed' : 'is-succeeded'}`}>{!moderation.enabled ? m.disabled : moderation.health.consecutiveFailures > 0 ? m.failing : moderation.calls >= moderation.budget ? m.budgetExhausted : m.healthy}</span></header>
      <p className="admin-help">{m.help}</p>
      <dl className="admin-evidence-list">
        <div><dt>{m.calls}</dt><dd>{moderation.calls} / {moderation.budget}</dd></div>
        <div><dt>{m.cached}</dt><dd>{moderation.cached}</dd></div>
        <div><dt>{m.local}</dt><dd>{moderation.local}</dd></div>
        <div><dt>{m.unavailable}</dt><dd>{moderation.unavailable}</dd></div>
        <div><dt>{m.outcomes}</dt><dd>{m.outcomeLine(moderation.published, moderation.pendingReview, moderation.rejected, moderation.rateLimited)}</dd></div>
        <div><dt>{m.lastError}</dt><dd>{moderation.health.lastErrorAt ? `${date(moderation.health.lastErrorAt.toISOString())} · ${moderation.health.lastErrorCode ?? ''}` : t.empty}</dd></div>
      </dl>
    </section>
    <section className="admin-metrics" aria-label={t.versionEvidence}>
      <article><small>{t.appCode}</small><strong>{info.applicationVersion}</strong><span>{t.app}</span></article>
      <article><small>{t.journalCode}</small><strong>{t.local}</strong><span className="mono-id">{info.migrationJournalLatest ?? t.notRecorded}</span></article>
      <article><small>{t.databaseCode}</small><strong>{info.databaseMigration.id ?? t.empty}</strong><span>{info.databaseMigration.status === 'recorded' ? t.migrationRecorded : t.notRecorded}</span></article>
      <article><small>{t.backupCode}</small><strong>{t.backup}</strong><span>{t.backupDetail}</span></article>
    </section>
    <section className="admin-panel"><h2>{t.migrationTimes}</h2><dl className="admin-evidence-list"><div><dt>{t.journalTime}</dt><dd>{date(info.databaseMigration.journalTimestamp)}</dd></div><div><dt>{t.appliedTime}</dt><dd>{date(info.databaseMigration.appliedAt)}</dd></div></dl><p className="notice">{t.migrationTimeHelp}</p></section>
    <section className="admin-panel"><header><h2>{t.maintenance}</h2><span>{t.timezone}</span></header><p className="admin-help">{t.maintenanceHelp}</p>
      <div className="admin-system-tasks">{info.maintenanceTasks.map((task) => <article key={task.task}><h3>{taskLabel(task.task)}<br /><code>{task.task}</code></h3><dl className="admin-evidence-list">
        <div><dt>{t.latest}</dt><dd>{task.latest ? <><span className={`admin-run-state is-${task.latest.status}`}>{t.statuses[task.latest.status]}</span><br />{date(task.latest.startedAt)}</> : t.notRun}</dd></div>
        <div><dt>{t.lastSuccess}</dt><dd>{date(task.lastSuccess?.completedAt ?? null)}</dd></div>
        <div><dt>{t.lastFailure}</dt><dd>{date(task.lastFailure?.completedAt ?? null)}{task.lastFailure?.errorCode && <><br /><code>{task.lastFailure.errorCode}</code></>}</dd></div>
      </dl></article>)}</div>
    </section>
    <section className="admin-panel"><header><h2>{t.history}</h2><span>{t.historyLimit}</span></header>{info.maintenance.length === 0 ? <p className="admin-empty">{t.notRun}</p> : <div className="admin-table-scroll" tabIndex={0} role="region" aria-label={t.history}>
      <table><caption className="sr-only">{t.history}</caption><thead><tr><th>{t.task}</th><th>{t.status}</th><th>{t.started}</th><th>{t.completed}</th><th>{t.errorCode}</th></tr></thead><tbody>{info.maintenance.map((run, index) => <tr key={`${run.task}:${run.startedAt}:${index}`}><td>{taskLabel(run.task)}</td><td>{t.statuses[run.status]}</td><td>{date(run.startedAt)}</td><td>{date(run.completedAt)}</td><td>{run.errorCode ?? t.empty}</td></tr>)}</tbody></table>
    </div>}</section>
  </main>;
}
