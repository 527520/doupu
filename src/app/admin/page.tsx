import Link from 'next/link';
import { forbidden } from 'next/navigation';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import Icon, { type IconName } from '@/components/ui/Icon';
import { getDb } from '@/lib/auth/db';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { getAdminOverview } from '@/lib/admin/overview';
import { zhCN } from '@/messages/zh-CN';

/** 后台总览：待办计数按处理顺序排列，取代原来直接跳转到审核台。 */
export default async function AdminOverviewPage() {
  const actor = await getSessionActor();
  if (!authorize(actor, 'community:moderate')) forbidden();
  const includeSystem = authorize(actor, 'system:read');
  const overview = await getAdminOverview(getDb(), { includeSystem });
  const t = zhCN.communityAdmin.overview;
  const nav = zhCN.communityAdmin.nav;
  const queues: Array<{ href: string; icon: IconName; label: string; help: string; count: number }> = [
    { href: '/admin/reviews', icon: 'inbox', label: t.pendingRevisions, help: t.pendingRevisionsHelp, count: overview.pendingRevisions },
    { href: '/admin/comments', icon: 'send', label: t.pendingComments, help: t.pendingCommentsHelp, count: overview.pendingComments },
    { href: '/admin/reports', icon: 'flag', label: t.openReports, help: t.openReportsHelp, count: overview.openReports },
  ];
  const shortcuts: Array<{ href: string; icon: IconName; label: string }> = [
    { href: '/admin/works', icon: 'images', label: nav.works },
    { href: '/admin/tags', icon: 'tag', label: nav.tags },
    ...(includeSystem ? [
      { href: '/admin/batches', icon: 'grid' as IconName, label: nav.batches },
      { href: '/admin/users', icon: 'users' as IconName, label: nav.users },
      { href: '/admin/analytics', icon: 'chart' as IconName, label: nav.analytics },
      { href: '/admin/audit', icon: 'list' as IconName, label: nav.audit },
    ] : []),
  ];
  const allClear = queues.every((queue) => queue.count === 0);
  return <main id="main" className="admin-page admin-overview">
    <AdminPageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} />
    <section className="admin-overview-queues" aria-label={t.title}>
      {queues.map((queue) => <Link key={queue.href} href={queue.href} className={`admin-overview-card${queue.count > 0 ? ' has-pending' : ''}`}>
        <span className="admin-overview-icon"><Icon name={queue.icon} size={20} /></span>
        <strong>{queue.count}</strong>
        <span className="admin-overview-label">{queue.label}</span>
        <small>{queue.help}</small>
        <span className="admin-overview-open">{t.open}<Icon name="arrow" size={14} /></span>
      </Link>)}
      {includeSystem && <Link href="/admin/system" className={`admin-overview-card is-system${overview.moderationDegraded ? ' has-pending' : ''}`}>
        <span className="admin-overview-icon"><Icon name="shield" size={20} /></span>
        <strong className="admin-overview-state">{overview.moderationDegraded ? t.moderationDegraded : t.moderationHealthy}</strong>
        <span className="admin-overview-label">{t.moderation}</span>
        <small>{t.moderationHelp}</small>
        <span className="admin-overview-open">{t.open}<Icon name="arrow" size={14} /></span>
      </Link>}
    </section>
    {allClear && <p className="admin-overview-clear"><Icon name="check" size={16} />{t.allClear} {t.allClearHelp}</p>}
    <section className="admin-panel admin-overview-shortcuts" aria-label={t.shortcuts}>
      <header><h2>{t.shortcuts}</h2></header>
      <div>{shortcuts.map((item) => <Link key={item.href} href={item.href} className="admin-shortcut"><Icon name={item.icon} size={18} />{item.label}</Link>)}</div>
    </section>
  </main>;
}
