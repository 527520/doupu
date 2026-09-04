import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import CommunityPreviewCanvas from '@/components/community/CommunityPreviewCanvas';
import { CommunityListImpression } from '@/components/community/CommunityImpression';
import { getDb } from '@/lib/auth/db';
import { listPublicCommunityWorks, parseCommunityListUrl } from '@/lib/community/queries';
import { zhCN } from '@/messages/zh-CN';

export const metadata: Metadata = { title: zhCN.communityAdmin.communityTitle, description: zhCN.communityAdmin.communityDescription };

export default async function CommunityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = zhCN.communityAdmin.community;
  const params = await searchParams;
  const url = new URL('http://local/community');
  for (const [key, raw] of Object.entries(params)) if (typeof raw === 'string') url.searchParams.set(key, raw);
  const query = parseCommunityListUrl(url.toString());
  const result = await listPublicCommunityWorks(getDb(), query);
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title={t.headerTitle} currentPath="/community" subtitle={t.headerSubtitle} primaryActions={<Link href="/community/mine" className="btn-outline btn-sm">{t.mine}</Link>} />
      <CommunityListImpression sort={query.sort} />
      <div className="workspace-content community-page">
        <section className="community-hero"><div><span className="studio-eyebrow">{t.eyebrow}</span><h2>{t.heroTitle}</h2><p>{t.heroBody}</p></div><Link href="/community/rules" className="btn-outline">{t.rules}</Link></section>
        <form className="community-filters" method="get">
          <label><span className="sr-only">{t.searchLabel}</span><input name="q" defaultValue={query.q} className="input-field" placeholder={t.searchPlaceholder} /></label>
          <label><span className="sr-only">{t.sortLabel}</span><select name="sort" defaultValue={query.sort} className="input-compact"><option value="latest">{t.latest}</option><option value="featured">{t.featured}</option><option value="popular">{t.popular}</option></select></label>
          <button className="btn-primary btn-sm">{t.filter}</button>
        </form>
        {result.items.length === 0 ? <section className="community-empty"><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p><Link href="/designs" className="btn-primary">{t.chooseDesign}</Link></section> : (
          <ul className="community-grid">{result.items.map((work, index) => (
            <li key={work.id} className="community-card">
              <Link href={`/community/${work.id}`} className="community-card-preview"><span className="community-proof-number">{String(index + 1).padStart(2, '0')}</span><CommunityPreviewCanvas preview={work.preview} label={t.preview(work.title)} /></Link>
              <div className="community-color-band" role="img" aria-label={t.colorBand(work.colorCount)}>{work.preview.colorBand.map((color) => <span key={color} style={{ backgroundColor: color }} />)}</div>
              <div className="community-card-body"><div><h2><Link href={`/community/${work.id}`}>{work.title}</Link></h2><p>{work.author.displayName} · {work.width}×{work.height}</p></div>{work.featured && <span className="community-featured">{t.featuredBadge}</span>}</div>
              {work.tags.length > 0 && <div className="community-tags">{work.tags.map((tag) => <Link key={tag.id} href={`/community?tag=${tag.slug}`}>{tag.name}</Link>)}</div>}
              <footer><span>{t.likes(work.counts.likes)}</span><span>{t.comments(work.counts.comments)}</span><span>{t.reuses(work.counts.reuses)}</span></footer>
            </li>
          ))}</ul>
        )}
        {result.nextCursor && <div className="community-more"><Link className="btn-outline" href={`/community?sort=${query.sort}&cursor=${encodeURIComponent(result.nextCursor)}`}>{t.next}</Link></div>}
      </div>
    </main>
  );
}
