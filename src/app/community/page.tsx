import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { ButtonLink } from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';
import CommunityThumbnail from '@/components/community/CommunityThumbnail';
import { CommunityListImpression } from '@/components/community/CommunityImpression';
import { getDb } from '@/lib/auth/db';
import { listPopularCommunityTags, listPublicCommunityWorks, parseCommunityListUrl, type CommunityListQuery } from '@/lib/community/queries';
import { communityTagHref } from '@/lib/community/tagHref';
import { zhCN } from '@/messages/zh-CN';
import CommunityFilters from '@/components/community/CommunityFilters';
import { AppError } from '@/lib/errors';

export const metadata: Metadata = { title: zhCN.communityAdmin.communityTitle, description: zhCN.communityAdmin.communityDescription };

function InvalidFilters() {
  const t = zhCN.communityAdmin.community;
  return <main id="main" className="workspace-page"><SiteHeader title={t.headerTitle} currentPath="/community" /><section className="community-empty pegboard"><span className="empty-state-icon" aria-hidden="true"><Icon name="filter" size={26} /></span><h2>{t.invalidFilters}</h2><p>{t.invalidFiltersHint}</p><ButtonLink variant="primary" icon="close" href="/community">{t.clearFilters}</ButtonLink></section></main>;
}

export default async function CommunityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = zhCN.communityAdmin.community;
  const params = await searchParams;
  const url = new URL('http://local/community');
  for (const [key, raw] of Object.entries(params)) if (typeof raw === 'string') url.searchParams.set(key, raw);
  let query: CommunityListQuery;
  try { query = parseCommunityListUrl(url.toString()); } catch { return <InvalidFilters />; }
  let result: Awaited<ReturnType<typeof listPublicCommunityWorks>>;
  let popularTags: Awaited<ReturnType<typeof listPopularCommunityTags>> = [];
  try { [result, popularTags] = await Promise.all([listPublicCommunityWorks(getDb(), query), listPopularCommunityTags(getDb())]); }
  catch (error) { if (error instanceof AppError && error.code === 'VALIDATION') return <InvalidFilters />; throw error; }
  const activeFilters = ['q', 'author', 'tag', 'boardProfile', 'palette', 'from', 'to'].some((key) => url.searchParams.has(key) && url.searchParams.get(key) !== '');
  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (typeof value === 'string') nextParams.set(key, value);
  const returnTo = `/community?${nextParams}`;
  nextParams.delete('cursor');
  if (result.nextCursor) nextParams.set('cursor', result.nextCursor);
  const withoutTag = new URLSearchParams(nextParams); withoutTag.delete('tag'); withoutTag.delete('cursor');
  const activeTag = query.tag ? popularTags.find((tag) => tag.name.toLocaleLowerCase('zh-CN') === query.tag!.toLocaleLowerCase('zh-CN') || tag.slug === query.tag)?.name ?? query.tag : null;
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title={t.headerTitle} currentPath="/community" primaryActions={<ButtonLink variant="secondary" size="sm" icon="folder" href="/community/mine">{t.mine}</ButtonLink>} />
      <CommunityListImpression sort={query.sort} />
      <div className="workspace-content community-page">
        <section className="community-hero"><div><h2>{t.heroTitle}</h2><p>{t.heroBody}</p></div><Link href="/community/rules" className="link-action">{t.rules}</Link></section>
        <CommunityFilters key={JSON.stringify(query)} query={query} />
        {(popularTags.length > 0 || activeTag) && <nav className="community-tag-bar" aria-label={t.tagBar}>
          {activeTag && <Link href={`/community?${withoutTag}`} className="community-tag-chip is-active" aria-label={t.clearTag(activeTag)}>{t.activeTag(activeTag)} ×</Link>}
          {popularTags.filter((tag) => tag.name !== activeTag).map((tag) => <Link key={tag.id} href={communityTagHref(tag.name)} className="community-tag-chip">{tag.name}<small>{tag.count}</small></Link>)}
        </nav>}
        {activeFilters && result.items.length > 0 && <Link href="/community" className="link-soft">{t.clearFilters}</Link>}
        {result.items.length === 0 ? <section className="community-empty pegboard"><span className="empty-state-icon" aria-hidden="true"><Icon name={activeFilters ? 'search' : 'grid'} size={26} /></span><h2>{activeFilters ? t.noMatch : t.emptyTitle}</h2><p>{activeFilters ? t.noMatchHint : t.emptyBody}</p><ButtonLink variant="primary" icon={activeFilters ? 'close' : 'folder'} href={activeFilters ? '/community' : '/designs'}>{activeFilters ? t.clearFilters : t.chooseDesign}</ButtonLink></section> : (
          <ul className="community-grid stagger">{result.items.map((work, index) => (
            <li key={work.id} className="community-card" style={{ '--i': index } as CSSProperties}>
              <Link href={`/community/${work.id}?returnTo=${encodeURIComponent(returnTo)}`} className="community-card-preview"><CommunityThumbnail revisionId={work.revisionId} width={work.width} height={work.height} label={t.preview(work.title)} /></Link>
              <div className="community-color-band" role="img" aria-label={t.colorBand(work.colorCount)}>{work.preview.colorBand.map((color) => <span key={color} style={{ backgroundColor: color }} />)}</div>
              <div className="community-card-body"><div><h2><Link href={`/community/${work.id}?returnTo=${encodeURIComponent(returnTo)}`}>{work.title}</Link></h2><p>{work.author.displayName} · {work.width}×{work.height}</p></div>{work.featured && <span className="community-featured">{t.featuredBadge}</span>}</div>
              {work.tags.length > 0 && <div className="community-tags">{work.tags.map((tag) => <Link key={tag.id} href={communityTagHref(tag.name)}>{tag.name}</Link>)}</div>}
              <footer><span>{t.likes(work.counts.likes)}</span><span>{t.comments(work.counts.comments)}</span><span>{t.reuses(work.counts.reuses)}</span></footer>
            </li>
          ))}</ul>
        )}
        {result.nextCursor && <div className="community-more"><ButtonLink variant="secondary" size="sm" icon="chevron-down" href={`/community?${nextParams}`}>{t.next}</ButtonLink></div>}
      </div>
    </main>
  );
}
