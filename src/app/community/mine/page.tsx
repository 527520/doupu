import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import CommunityPreviewCanvas from '@/components/community/CommunityPreviewCanvas';
import CommunityMineActions from '@/components/community/CommunityMineActions';
import { getSessionActor } from '@/lib/auth/session';
import { getDb } from '@/lib/auth/db';
import { listOwnCommunityWorks } from '@/lib/community/queries';
import { zhCN } from '@/messages/zh-CN';

export const metadata: Metadata = { title: zhCN.communityAdmin.mineTitle, robots: { index: false, follow: false } };

const nextStep: Record<string, string> = zhCN.communityAdmin.minePage.nextStep;

export default async function CommunityMinePage() {
  const actor = await getSessionActor();
  if (!actor) redirect('/login?next=/community/mine');
  const items = await listOwnCommunityWorks(getDb(), actor.userId);
  const t = zhCN.communityAdmin.minePage;
  const states = zhCN.communityAdmin.states;
  return <main id="main" className="workspace-page"><SiteHeader title={t.title} currentPath="/community/mine" subtitle={t.progressSubtitle} primaryActions={<Link href="/community/submit" className="btn-primary btn-sm">{t.chooseForSubmission}</Link>} /><div className="workspace-content community-page">
    {items.length === 0 ? <section className="community-empty"><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p><Link href="/community/submit" className="btn-primary">{t.chooseDesign}</Link></section> : <ul className="community-mine-list">{items.map((work) => {
      const latest = work.revisions[0];
      const active = work.lifecycleStatus === 'active';
      return <li key={work.id}>
        <header><h2>{latest?.title ?? zhCN.communityAdmin.untitled}</h2><span data-status={active ? latest?.status : work.lifecycleStatus}>{active && latest ? states.revision[latest.status] : states.work[work.lifecycleStatus]}</span></header>
        {latest ? <div className="community-mine-current"><CommunityPreviewCanvas preview={latest.preview} label={t.preview(latest.title)} /><div>
          <p>{t.author}{latest.frozenDisplayName}</p>
          <p>{active ? nextStep[latest.status] : work.lifecycleStatus === 'removed' ? t.removedHelp : t.withdrawnHelp}</p>
          {latest.reviewReason && <p className="notice">{t.reviewReason}{latest.reviewReason}</p>}
          {active && work.currentPublishedRevisionId && latest.id !== work.currentPublishedRevisionId && <p>{t.originalVisible}</p>}
        </div></div> : <p role="alert">{t.previewFailed}</p>}
        {active && latest && <CommunityMineActions key={`${work.id}-${work.version}-${latest.id}-${latest.version}`} workId={work.id} version={work.version} revision={latest} hasPublished={Boolean(work.currentPublishedRevisionId)} />}
        <footer>{active && work.currentPublishedRevisionId && <Link className="btn-outline btn-sm" href={`/community/${work.id}`}>{t.publicPage}</Link>}{!active && <Link className="link-soft" href="/community/copyright">{t.copyright}</Link>}</footer>
        {work.revisions.length > 1 && <details className="community-mine-history"><summary>{t.history(work.revisions.length - 1)}</summary><div className="community-mine-revisions">{work.revisions.slice(1).map((revision) => <article key={revision.id}><CommunityPreviewCanvas preview={revision.preview} label={t.preview(revision.title)} /><div><strong>{revision.title} · {states.revision[revision.status]}</strong><p>{revision.reviewReason ?? nextStep[revision.status]}</p></div></article>)}</div></details>}
      </li>;
    })}</ul>}
  </div></main>;
}
