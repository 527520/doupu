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

const nextStep: Record<string, string> = {
  draft: '已保存冻结草稿，尚未提交审核。可以直接提交；如需修改，请先撤回草稿。',
  pending_review: '正在等待审核，审核通过后才会公开这次内容。',
  published: '作品已公开。修改设计后，可以提交新版本重新审核。',
  rejected: '这次投稿未通过。请按审核意见修改设计，再重新投稿。',
  withdrawn: '这次投稿已撤回。可以选择自己的设计，重新提交。',
  superseded: '此版本已由更新的审核通过版本替代。',
};

export default async function CommunityMinePage() {
  const actor = await getSessionActor();
  if (!actor) redirect('/login?next=/community/mine');
  const items = await listOwnCommunityWorks(getDb(), actor.userId);
  const t = zhCN.communityAdmin.minePage;
  const states = zhCN.communityAdmin.states;
  return <main id="main" className="workspace-page"><SiteHeader title={t.title} currentPath="/community/mine" subtitle="查看审核进度，继续处理自己的投稿" primaryActions={<Link href="/community/submit" className="btn-primary btn-sm">选择设计投稿</Link>} /><div className="workspace-content community-page">
    {items.length === 0 ? <section className="community-empty"><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p><Link href="/community/submit" className="btn-primary">{t.chooseDesign}</Link></section> : <ul className="community-mine-list">{items.map((work) => {
      const latest = work.revisions[0];
      const active = work.lifecycleStatus === 'active';
      return <li key={work.id}>
        <header><h2>{latest?.title ?? zhCN.communityAdmin.untitled}</h2><span data-status={active ? latest?.status : work.lifecycleStatus}>{active && latest ? states.revision[latest.status] : states.work[work.lifecycleStatus]}</span></header>
        {latest ? <div className="community-mine-current"><CommunityPreviewCanvas preview={latest.preview} label={t.preview(latest.title)} /><div>
          <p>公开作者：{latest.frozenDisplayName}</p>
          <p>{active ? nextStep[latest.status] : work.lifecycleStatus === 'removed' ? '作品已下架，当前不可公开访问。如有异议，请查看申诉说明。' : '整件作品已撤回，当前不可公开访问。已有私人副本保留。'}</p>
          {latest.reviewReason && <p className="notice">审核意见：{latest.reviewReason}</p>}
          {active && work.currentPublishedRevisionId && latest.id !== work.currentPublishedRevisionId && <p>原审核通过的版本仍在公开展示。</p>}
        </div></div> : <p role="alert">预览暂时无法读取，请刷新后重试。</p>}
        {active && latest && <CommunityMineActions key={`${work.id}-${work.version}-${latest.id}-${latest.version}`} workId={work.id} version={work.version} revision={latest} hasPublished={Boolean(work.currentPublishedRevisionId)} />}
        <footer>{active && work.currentPublishedRevisionId && <Link className="btn-outline btn-sm" href={`/community/${work.id}`}>{t.publicPage}</Link>}{!active && <Link className="link-soft" href="/community/copyright">版权与申诉说明</Link>}</footer>
        {work.revisions.length > 1 && <details className="community-mine-history"><summary>查看历史投稿（{work.revisions.length - 1} 次）</summary><div className="community-mine-revisions">{work.revisions.slice(1).map((revision) => <article key={revision.id}><CommunityPreviewCanvas preview={revision.preview} label={t.preview(revision.title)} /><div><strong>{revision.title} · {states.revision[revision.status]}</strong><p>{revision.reviewReason ?? nextStep[revision.status]}</p></div></article>)}</div></details>}
      </li>;
    })}</ul>}
  </div></main>;
}
