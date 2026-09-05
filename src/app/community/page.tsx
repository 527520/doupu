import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import CommunityPreviewCanvas from '@/components/community/CommunityPreviewCanvas';
import { CommunityListImpression } from '@/components/community/CommunityImpression';
import { getDb } from '@/lib/auth/db';
import { listPublicCommunityWorks, parseCommunityListUrl, type CommunityListQuery } from '@/lib/community/queries';
import { zhCN } from '@/messages/zh-CN';
import { BOARD_PROFILE_IDS, getBoardProfile } from '@/lib/boardProfiles';
import { AppError } from '@/lib/errors';

export const metadata: Metadata = { title: zhCN.communityAdmin.communityTitle, description: zhCN.communityAdmin.communityDescription };

function InvalidFilters() {
  const t = zhCN.communityAdmin.community;
  return <main id="main" className="workspace-page"><SiteHeader title={t.headerTitle} currentPath="/community" /><section className="community-empty"><h2>{t.invalidFilters}</h2><p>{t.invalidFiltersHint}</p><Link href="/community" className="btn-primary">{t.clearFilters}</Link></section></main>;
}

export default async function CommunityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = zhCN.communityAdmin.community;
  const params = await searchParams;
  const url = new URL('http://local/community');
  for (const [key, raw] of Object.entries(params)) if (typeof raw === 'string') url.searchParams.set(key, raw);
  let query: CommunityListQuery;
  try { query = parseCommunityListUrl(url.toString()); } catch { return <InvalidFilters />; }
  let result: Awaited<ReturnType<typeof listPublicCommunityWorks>>;
  try { result = await listPublicCommunityWorks(getDb(), query); }
  catch (error) { if (error instanceof AppError && error.code === 'VALIDATION') return <InvalidFilters />; throw error; }
  const activeFilters = ['q', 'author', 'tag', 'boardProfile', 'palette', 'from', 'to'].some((key) => url.searchParams.has(key) && url.searchParams.get(key) !== '');
  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (typeof value === 'string') nextParams.set(key, value);
  const returnTo = `/community?${nextParams}`;
  nextParams.delete('cursor');
  if (result.nextCursor) nextParams.set('cursor', result.nextCursor);
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title={t.headerTitle} currentPath="/community" subtitle={t.headerSubtitle} primaryActions={<Link href="/community/mine" className="btn-outline btn-sm">{t.mine}</Link>} />
      <CommunityListImpression sort={query.sort} />
      <div className="workspace-content community-page">
        <section className="community-hero"><div><span className="studio-eyebrow">{t.eyebrow}</span><h2>{t.heroTitle}</h2><p>{t.heroBody}</p></div><Link href="/community/rules" className="btn-outline">{t.rules}</Link></section>
        <form className="community-filters" method="get" action="/community">
          <label><span className="sr-only">{t.searchLabel}</span><input name="q" maxLength={80} defaultValue={query.q} className="input-field" placeholder={t.searchPlaceholder} /></label>
          <label><span className="sr-only">{t.sortLabel}</span><select name="sort" defaultValue={query.sort} className="input-compact"><option value="latest">{t.latest}</option><option value="featured">{t.featured}</option><option value="popular">{t.popular}</option></select></label>
          <button className="btn-primary btn-sm">{t.filter}</button>
          {query.tag && <input type="hidden" name="tag" value={query.tag} />}
          {query.palette && <input type="hidden" name="palette" value={query.palette} />}
          <details className="community-filter-details"><summary>{t.moreFilters}</summary><div>
            <label>{t.authorFilter}<input name="author" defaultValue={query.author} maxLength={80} className="input-field" /></label>
            <label>{t.boardFilter}<select name="boardProfile" defaultValue={query.boardProfile ?? ''} className="input-field"><option value="">{t.allBoards}</option>{BOARD_PROFILE_IDS.map((id) => <option key={id} value={id}>{getBoardProfile(id).displayName}</option>)}</select></label>
            <label>{t.fromDate}<input type="date" name="from" defaultValue={query.from} className="input-field" /></label>
            <label>{t.toDate}<input type="date" name="to" defaultValue={query.to} className="input-field" /></label>
          </div></details>
        </form>
        {activeFilters && result.items.length > 0 && <Link href="/community" className="link-soft">{t.clearFilters}</Link>}
        {result.items.length === 0 ? <section className="community-empty"><h2>{activeFilters ? t.noMatch : t.emptyTitle}</h2><p>{activeFilters ? t.noMatchHint : t.emptyBody}</p><Link href={activeFilters ? '/community' : '/designs'} className="btn-primary">{activeFilters ? t.clearFilters : t.chooseDesign}</Link></section> : (
          <ul className="community-grid">{result.items.map((work) => (
            <li key={work.id} className="community-card">
              <Link href={`/community/${work.id}?returnTo=${encodeURIComponent(returnTo)}`} className="community-card-preview"><CommunityPreviewCanvas preview={work.preview} label={t.preview(work.title)} /></Link>
              <div className="community-color-band" role="img" aria-label={t.colorBand(work.colorCount)}>{work.preview.colorBand.map((color) => <span key={color} style={{ backgroundColor: color }} />)}</div>
              <div className="community-card-body"><div><h2><Link href={`/community/${work.id}?returnTo=${encodeURIComponent(returnTo)}`}>{work.title}</Link></h2><p>{work.author.displayName} · {work.width}×{work.height}</p></div>{work.featured && <span className="community-featured">{t.featuredBadge}</span>}</div>
              {work.tags.length > 0 && <div className="community-tags">{work.tags.map((tag) => <Link key={tag.id} href={`/community?tag=${tag.slug}`}>{tag.name}</Link>)}</div>}
              <footer><span>{t.likes(work.counts.likes)}</span><span>{t.comments(work.counts.comments)}</span><span>{t.reuses(work.counts.reuses)}</span></footer>
            </li>
          ))}</ul>
        )}
        {result.nextCursor && <div className="community-more"><Link className="btn-outline" href={`/community?${nextParams}`}>{t.next}</Link></div>}
      </div>
    </main>
  );
}
