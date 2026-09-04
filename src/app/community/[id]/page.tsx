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
  return { title: work.title, description: `${work.author.displayName} 的 ${work.width}×${work.height} 拼豆图纸`, openGraph: { title: work.title, description: `${work.author.displayName} 的豆社作品` } };
}

export default async function CommunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const work = await load((await params).id);
  if (!work) notFound();
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title="豆社作品" currentPath="/community" subtitle={`校样编号 ${work.id.slice(0, 8).toUpperCase()}`} />
      <CommunityDetailImpression />
      <div className="workspace-content community-detail">
        <header className="community-detail-header"><div><span className="studio-eyebrow">PUBLISHED PROOF</span><h2>{work.title}</h2><p>作者 {work.author.displayName} · 发布于 {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeZone: 'Asia/Shanghai' }).format(new Date(work.publishedAt))}</p></div>{work.featured && <span className="community-featured">人工精选</span>}</header>
        <div className="community-detail-layout">
          <section className="community-pattern"><PatternPreview pattern={work.snapshot.pattern} boardSize={getBoardProfile(work.snapshot.boardProfile).boardCols} /></section>
          <aside className="community-proof-meta">
            <dl><div><dt>尺寸</dt><dd>{work.width} × {work.height}</dd></div><div><dt>用色</dt><dd>{work.colorCount} 种</dd></div><div><dt>制作规格</dt><dd>{getBoardProfile(work.snapshot.boardProfile).displayName}</dd></div><div><dt>引擎版本</dt><dd>{work.snapshot.engineVersion}</dd></div></dl>
            <div className="community-color-band large">{work.preview.colorBand.map((color) => <span key={color} style={{ backgroundColor: color }} />)}</div>
            <div className="community-tags">{work.tags.map((tag) => <Link key={tag.id} href={`/community?tag=${tag.slug}`}>{tag.name}</Link>)}</div>
            <p className="community-license-note">本作品按豆社有限平台许可展示。引用功能只会创建你的私人副本，不授予站外传播、商业使用或再许可权。</p>
            <div className="community-counts"><span>{work.counts.likes} 赞</span><span>{work.counts.comments} 评论</span><span>{work.counts.reuses} 次引用</span></div>
          </aside>
        </div>
        <CommunityInteractions workId={work.id} initialLikes={work.counts.likes} initialReuses={work.counts.reuses} commentsLocked={work.commentsLocked} />
      </div>
    </main>
  );
}
