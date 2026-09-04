import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import CommunityPreviewCanvas from '@/components/community/CommunityPreviewCanvas';
import { CommunityListImpression } from '@/components/community/CommunityImpression';
import { getDb } from '@/lib/auth/db';
import { listPublicCommunityWorks, parseCommunityListUrl } from '@/lib/community/queries';

export const metadata: Metadata = { title: '豆社作品校样册', description: '浏览豆友公开分享的冻结拼豆图纸，并创建自己的私人副本。' };

export default async function CommunityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const url = new URL('http://local/community');
  for (const [key, raw] of Object.entries(params)) if (typeof raw === 'string') url.searchParams.set(key, raw);
  const query = parseCommunityListUrl(url.toString());
  const result = await listPublicCommunityWorks(getDb(), query);
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title="豆社" currentPath="/community" subtitle="公开的是冻结图纸，不是你的私人设计" primaryActions={<Link href="/community/mine" className="btn-outline btn-sm">我的投稿</Link>} />
      <CommunityListImpression sort={query.sort} />
      <div className="workspace-content community-page">
        <section className="community-hero"><div><span className="studio-eyebrow">COMMUNITY PROOFS</span><h2>作品校样册</h2><p>每一页都是审核通过的冻结版本。新修改审核期间，旧版照常可看。</p></div><Link href="/community/rules" className="btn-outline">阅读社区规则</Link></section>
        <form className="community-filters" method="get">
          <label><span className="sr-only">搜索标题或作者</span><input name="q" defaultValue={query.q} className="input-field" placeholder="搜索作品标题" /></label>
          <label><span className="sr-only">排序</span><select name="sort" defaultValue={query.sort} className="input-compact"><option value="latest">最新发布</option><option value="featured">人工精选</option><option value="popular">互动较多</option></select></label>
          <button className="btn-primary btn-sm">筛选</button>
        </form>
        {result.items.length === 0 ? <section className="community-empty"><h2>还没有符合条件的作品</h2><p>可以先从自己的云端设计发起第一份投稿。</p><Link href="/designs" className="btn-primary">前往我的设计</Link></section> : (
          <ul className="community-grid">{result.items.map((work, index) => (
            <li key={work.id} className="community-card">
              <Link href={`/community/${work.id}`} className="community-card-preview"><span className="community-proof-number">{String(index + 1).padStart(2, '0')}</span><CommunityPreviewCanvas preview={work.preview} label={`${work.title} 图纸预览`} /></Link>
              <div className="community-color-band" aria-label={`${work.colorCount} 种用色`}>{work.preview.colorBand.map((color) => <span key={color} style={{ backgroundColor: color }} />)}</div>
              <div className="community-card-body"><div><h2><Link href={`/community/${work.id}`}>{work.title}</Link></h2><p>{work.author.displayName} · {work.width}×{work.height}</p></div>{work.featured && <span className="community-featured">精选</span>}</div>
              {work.tags.length > 0 && <div className="community-tags">{work.tags.map((tag) => <Link key={tag.id} href={`/community?tag=${tag.slug}`}>{tag.name}</Link>)}</div>}
              <footer><span>赞 {work.counts.likes}</span><span>评 {work.counts.comments}</span><span>引用 {work.counts.reuses}</span></footer>
            </li>
          ))}</ul>
        )}
        {result.nextCursor && <div className="community-more"><Link className="btn-outline" href={`/community?sort=${query.sort}&cursor=${encodeURIComponent(result.nextCursor)}`}>下一页</Link></div>}
      </div>
    </main>
  );
}
