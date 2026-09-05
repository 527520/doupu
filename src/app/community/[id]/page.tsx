import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import PatternPreview from '@/components/preview/PatternPreview';
import { CommunityDetailImpression } from '@/components/community/CommunityImpression';
import CommunityInteractions from '@/components/community/CommunityInteractions';
import { getDb } from '@/lib/auth/db';
import { getPublicCommunityWork } from '@/lib/community/queries';
import { getBoardProfile } from '@/lib/boardProfiles';
import { zhCN } from '@/messages/zh-CN';

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/iu.test(id)) return null;
  return getPublicCommunityWork(getDb(), id);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const work = await load((await params).id);
  if (!work) return { title: zhCN.communityAdmin.communityMissing, robots: { index: false, follow: false } };
  return { title: work.title, description: zhCN.communityAdmin.detail.metadataDescription(work.author.displayName, work.width, work.height), openGraph: { title: work.title, description: zhCN.communityAdmin.detail.openGraphDescription(work.author.displayName) } };
}

export default async function CommunityDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const work = await load((await params).id);
  if (!work) notFound();
  const t = zhCN.communityAdmin.detail;
  const candidate = (await searchParams)?.returnTo;
  const returnTo = typeof candidate === 'string' && candidate.length <= 2000 && candidate.startsWith('/community?') && !/[\\\r\n]/u.test(candidate) ? candidate : '/community';
  const publishedAt = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeZone: 'Asia/Shanghai' }).format(new Date(work.publishedAt));
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title={t.headerTitle} currentPath="/community" />
      <CommunityDetailImpression />
      <div className="workspace-content community-detail">
        <Link className="link-soft" href={returnTo}>{t.backToList}</Link>
        <header className="community-detail-header"><div><h2>{work.title}</h2><p>{t.publication(work.author.displayName, publishedAt)}</p></div>{work.featured && <span className="community-featured">{t.featured}</span>}</header>
        <div className="community-detail-layout">
          <section className="community-pattern"><PatternPreview pattern={work.snapshot.pattern} boardSize={getBoardProfile(work.snapshot.boardProfile).boardCols} /></section>
          <CommunityInteractions key={work.id} workId={work.id} initialLikes={work.counts.likes} initialReuses={work.counts.reuses} commentsLocked={work.commentsLocked}>
          <aside className="community-proof-meta">
            <dl><div><dt>{t.size}</dt><dd>{work.width} × {work.height}</dd></div><div><dt>{t.colors}</dt><dd>{t.colorValue(work.colorCount)}</dd></div><div><dt>{t.boardProfile}</dt><dd>{getBoardProfile(work.snapshot.boardProfile).displayName}</dd></div></dl>
            <div className="community-color-band large">{work.preview.colorBand.map((color) => <span key={color} style={{ backgroundColor: color }} />)}</div>
            <div className="community-tags">{work.tags.map((tag) => <Link key={tag.id} href={`/community?tag=${tag.slug}`}>{tag.name}</Link>)}</div>
            <p className="community-license-note">{t.license}</p>
            <details><summary>{t.technicalDetails}</summary><dl><div><dt>{t.engineVersion}</dt><dd>{work.snapshot.engineVersion}</dd></div></dl></details>
          </aside>
          </CommunityInteractions>
        </div>
      </div>
    </main>
  );
}
