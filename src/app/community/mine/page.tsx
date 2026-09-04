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

export default async function CommunityMinePage() {
  const actor = await getSessionActor();
  if (!actor) redirect('/login?next=/community/mine');
  const items = await listOwnCommunityWorks(getDb(), actor.userId);
  const t = zhCN.communityAdmin.minePage;
  const states = zhCN.communityAdmin.states;
  return <main id="main" className="workspace-page"><SiteHeader title={t.title} currentPath="/community/mine" subtitle={t.subtitle} primaryActions={<Link href="/designs" className="btn-primary btn-sm">{t.submitFromDesign}</Link>} /><div className="workspace-content community-page">
    {items.length === 0 ? <section className="community-empty"><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p><Link href="/designs" className="btn-primary">{t.chooseDesign}</Link></section> : <ul className="community-mine-list">{items.map((work) => <li key={work.id}><header><div><small>{work.id.slice(0, 8).toUpperCase()}</small><h2>{work.revisions[0]?.title ?? zhCN.communityAdmin.untitled}</h2></div><span data-status={work.lifecycleStatus}>{states.work[work.lifecycleStatus]}</span></header><div className="community-mine-revisions">{work.revisions.map((revision) => <article key={revision.id}><CommunityPreviewCanvas preview={revision.preview} label={t.preview(revision.title)} /><div><strong>{t.revision(revision.revisionNumber, states.revision[revision.status])}</strong><p>{revision.reviewReason ?? (revision.status === 'pending_review' ? zhCN.communityAdmin.waitingReview : zhCN.communityAdmin.notSubmitted)}</p></div></article>)}</div>{work.lifecycleStatus === 'active' && <footer><CommunityMineActions workId={work.id} version={work.version} />{work.currentPublishedRevisionId && <Link className="btn-outline btn-xs" href={`/community/${work.id}`}>{t.publicPage}</Link>}</footer>}</li>)}</ul>}
  </div></main>;
}
