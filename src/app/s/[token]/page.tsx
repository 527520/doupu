/**
 * 只读分享页 /s/[token]（批次 K，决策 D38）。
 *
 * 服务端渲染，不需要登录、不暴露作者信息、不可编辑。给的是「看图 + 照着拼」需要的东西：
 * 图纸预览、尺寸、用色清单（含每色粒数），以及把它复制到自己账号继续编辑的入口说明。
 *
 * robots：分享链接是私密的（拿到链接才能看），所以 noindex——
 * 用户把链接发给朋友，不代表愿意被搜索引擎收录。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/auth/db';
import { designShares } from '@/../db/schema';
import { hashToken } from '@/lib/auth/tokens';
import { parseShareSnapshot, type ShareSnapshot } from '@/lib/share/snapshot';
import { computeStats, totalBeadCount } from '@/lib/engine/generate';
import { zhCN } from '@/messages/zh-CN';
import SharedPatternView from '@/components/share/SharedPatternView';
import Brand from '@/components/layout/Brand';
import Icon from '@/components/ui/Icon';

export const metadata: Metadata = {
  title: zhCN.share.pageTitle,
  robots: { index: false, follow: false },
};

async function loadShare(token: string): Promise<ShareSnapshot | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const db = getDb();
  const rows = await db
    .select({ id: designShares.id, snapshot: designShares.snapshot })
    .from(designShares)
    .where(eq(designShares.tokenHash, hashToken(token)));
  if (rows.length === 0) return null;
  // 浏览计数：作者想知道链接有没有人看；不记录访客任何标识。
  await db
    .update(designShares)
    .set({ viewCount: sql`${designShares.viewCount} + 1` })
    .where(eq(designShares.id, rows[0].id));
  return parseShareSnapshot(rows[0].snapshot);
}

export default async function SharedDesignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const snapshot = await loadShare(token);
  if (!snapshot) notFound();

  const stats = computeStats(snapshot.pattern.cells);
  const total = totalBeadCount(stats);
  const t = zhCN.share;

  return (
    <main id="main" className="share-studio-page">
      <header className="share-studio-header">
        <Brand />
        <span><Icon name="lock" size={14} />{t.readonlyBadge}</span>
      </header>

      <section className="share-studio-content">
        <header className="share-studio-intro">
          <div>
            <p className="studio-eyebrow">{t.pageKicker}</p>
            <h1>{snapshot.name.trim() || zhCN.project.unnamed}</h1>
          </div>
          <strong>{t.summary(snapshot.pattern.width, snapshot.pattern.height, total, stats.length)}</strong>
        </header>

        <SharedPatternView pattern={snapshot.pattern} stats={stats} />

        <footer className="share-studio-cta">
          <div><Icon name="spark" size={20} /><p>{t.cta}</p></div>
          <Link href="/app" className="btn-primary">
            {t.makeYourOwn}<Icon name="arrow" size={15} />
          </Link>
        </footer>
      </section>
    </main>
  );
}
