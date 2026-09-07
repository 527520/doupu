import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import PatternPreview from '@/components/preview/PatternPreview';
import Badge from '@/components/ui/Badge';
import Disclosure from '@/components/ui/Disclosure';
import Icon from '@/components/ui/Icon';
import { CommunityDetailImpression } from '@/components/community/CommunityImpression';
import { WorkActions, WorkComments } from '@/components/community/CommunityInteractions';
import { getDb } from '@/lib/auth/db';
import { getSessionActor } from '@/lib/auth/session';
import { getPublicCommunityWork } from '@/lib/community/queries';
import { communityTagHref } from '@/lib/community/tagHref';
import { communityThumbnailUrl } from '@/lib/community/thumbnailUrl';
import { DEFAULT_BOARD_PROFILE_ID, getBoardProfile, isBoardProfileId } from '@/lib/boardProfiles';
import { thumbnailPixelSize } from '@/lib/render/thumbnailSize';
import { zhCN } from '@/messages/zh-CN';

async function load(id: string, includeSnapshot = false) {
  if (!/^[0-9a-f-]{36}$/iu.test(id)) return null;
  return getPublicCommunityWork(getDb(), id, { includeSnapshot });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const work = await load((await params).id);
  if (!work) return { title: zhCN.communityAdmin.communityMissing, robots: { index: false, follow: false } };
  const image = thumbnailPixelSize(work.width, work.height);
  return {
    title: work.title,
    description: zhCN.communityAdmin.detail.metadataDescription(work.author.displayName, work.width, work.height),
    openGraph: {
      title: work.title,
      description: zhCN.communityAdmin.detail.openGraphDescription(work.author.displayName),
      images: [{ url: communityThumbnailUrl(work.revisionId), width: image.width, height: image.height, alt: work.title }],
    },
  };
}

export default async function CommunityDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  // 匿名访客只拿服务端渲染的大图，不把完整图纸网格与色板 JSON 随页面下发（ADR-0021）。
  const actor = await getSessionActor();
  const canInteract = Boolean(actor);
  const work = await load((await params).id, canInteract);
  if (!work) notFound();
  const t = zhCN.communityAdmin.detail;
  const candidate = (await searchParams)?.returnTo;
  const returnTo = typeof candidate === 'string' && candidate.length <= 2000 && candidate.startsWith('/community?') && !/[\\\r\n]/u.test(candidate) ? candidate : '/community';
  const publishedAt = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeZone: 'Asia/Shanghai' }).format(new Date(work.publishedAt));
  const board = getBoardProfile(isBoardProfileId(work.boardProfile) ? work.boardProfile : DEFAULT_BOARD_PROFILE_ID);
  const large = thumbnailPixelSize(work.width, work.height, 'large');
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title={t.headerTitle} currentPath="/community" />
      <CommunityDetailImpression />
      <div className="workspace-content community-detail">
        <Link className="community-back" href={returnTo}><Icon name="chevron-left" size={16} />{t.backToList}</Link>
        <header className="community-detail-header">
          <div className="community-detail-title">
            <h2>{work.title}</h2>
            <p>{t.publication(work.author.displayName, publishedAt)}{work.featured && <Badge tone="featured" className="community-featured">{t.featured}</Badge>}</p>
          </div>
          <WorkActions key={work.id} workId={work.id} initialLikes={work.counts.likes} initialReuses={work.counts.reuses} canInteract={canInteract} />
        </header>
        <div className="community-detail-layout">
          <section className="community-pattern" aria-label={t.patternStage}>
            {work.snapshot
              ? <PatternPreview pattern={work.snapshot.pattern} boardSize={board.boardCols} />
              : <div className="community-pattern-static">
                {/* eslint-disable-next-line @next/next/no-img-element -- 服务端渲染的 PNG，尺寸已知，不需要 next/image 的优化管线 */}
                <img src={communityThumbnailUrl(work.revisionId, 'large')} width={large.width} height={large.height} alt={t.staticPatternAlt(work.title)} loading="eager" decoding="async" />
                <p className="community-pattern-gate"><Icon name="lock" size={15} /><span>{t.loginForCodes} <Link href={`/login?next=${encodeURIComponent(`/community/${work.id}`)}`}>{zhCN.communityAdmin.interaction.loginContinue}</Link></span></p>
              </div>}
          </section>
          <aside className="community-spec-card" aria-labelledby="community-spec-title">
            <h2 id="community-spec-title">{t.specTitle}</h2>
            <dl className="community-spec-grid">
              <div><dt>{t.size}</dt><dd>{work.width} × {work.height}</dd></div>
              <div><dt>{t.colors}</dt><dd>{t.colorValue(work.colorCount)}</dd></div>
              <div><dt>{t.boardProfile}</dt><dd>{board.displayName}</dd></div>
            </dl>
            <div className="community-color-band large" aria-label={t.colorBand}>{work.preview.colorBand.map((color) => <span key={color} style={{ backgroundColor: color }} />)}</div>
            {work.tags.length > 0 && <div className="community-tags">{work.tags.map((tag) => <Link key={tag.id} href={communityTagHref(tag.name)} className="community-tag-chip"><Icon name="tag" size={13} />{tag.name}</Link>)}</div>}
            <p className="community-license-note"><Icon name="shield" size={15} /><span>{t.license}</span></p>
            <Disclosure compact summary={t.technicalDetails}><dl className="community-spec-facts"><div><dt>{t.engineVersion}</dt><dd>{work.engineVersion}</dd></div><div><dt>{t.revisionId}</dt><dd>{work.revisionId}</dd></div></dl></Disclosure>
          </aside>
        </div>
        <WorkComments key={`${work.id}-comments`} workId={work.id} commentsLocked={work.commentsLocked} canInteract={canInteract} />
      </div>
    </main>
  );
}
