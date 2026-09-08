import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { ButtonLink } from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';
import Notice from '@/components/ui/Notice';
import CommunityThumbnail from '@/components/community/CommunityThumbnail';
import CommunityMineActions from '@/components/community/CommunityMineActions';
import Disclosure from '@/components/ui/Disclosure';
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
  return <main id="main" className="workspace-page"><SiteHeader title={t.title} currentPath="/community/mine" subtitle={t.progressSubtitle} primaryActions={<ButtonLink variant="primary" size="sm" icon="send" href="/community/submit">{t.chooseForSubmission}</ButtonLink>} /><div className="workspace-content community-page">
    {items.length === 0 ? <section className="community-empty pegboard"><span className="empty-state-icon" aria-hidden="true"><Icon name="send" size={26} /></span><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p><ButtonLink variant="primary" icon="send" href="/community/submit">{t.chooseDesign}</ButtonLink></section> : <ul className="community-mine-list stagger">{items.map((work, index) => {
      const latest = work.revisions[0];
      const active = work.lifecycleStatus === 'active';
      return <li key={work.id} style={{ '--i': index } as CSSProperties}>
        <header><h2>{latest?.title ?? zhCN.communityAdmin.untitled}</h2><span data-status={active ? latest?.status : work.lifecycleStatus}>{active && latest ? states.revision[latest.status] : states.work[work.lifecycleStatus]}</span></header>
        {latest ? <div className="community-mine-current"><CommunityThumbnail revisionId={latest.id} width={latest.preview.originalWidth} height={latest.preview.originalHeight} label={t.preview(latest.title)} /><div>
          <p>{t.author}{latest.frozenDisplayName}</p>
          <p>{active ? nextStep[latest.status] : work.lifecycleStatus === 'removed' ? t.removedHelp : t.withdrawnHelp}</p>
          {latest.reviewReason && <Notice kind="info" compact>{t.reviewReason}{latest.reviewReason}</Notice>}
          {active && work.currentPublishedRevisionId && latest.id !== work.currentPublishedRevisionId && <p>{t.originalVisible}</p>}
        </div></div> : <p role="alert">{t.previewFailed}</p>}
        {active && latest && <CommunityMineActions key={`${work.id}-${work.version}-${latest.id}-${latest.version}`} workId={work.id} version={work.version} revision={latest} hasPublished={Boolean(work.currentPublishedRevisionId)} />}
        <footer>{active && work.currentPublishedRevisionId && <ButtonLink variant="secondary" size="sm" icon="eye" href={`/community/${work.id}`}>{t.publicPage}</ButtonLink>}{!active && <Link className="link-soft" href="/community/copyright">{t.copyright}</Link>}</footer>
        {work.revisions.length > 1 && <Disclosure className="community-mine-history is-flat" icon="clock" summary={t.history(work.revisions.length - 1)}><div className="community-mine-revisions">{work.revisions.slice(1).map((revision) => <article key={revision.id}><CommunityThumbnail revisionId={revision.id} width={revision.preview.originalWidth} height={revision.preview.originalHeight} label={t.preview(revision.title)} /><div><strong>{revision.title} · {states.revision[revision.status]}</strong><p>{revision.reviewReason ?? nextStep[revision.status]}</p></div></article>)}</div></Disclosure>}
      </li>;
    })}</ul>}
  </div></main>;
}
