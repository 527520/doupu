import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import SiteHeader from '@/components/layout/SiteHeader';
import CommunitySubmitForm from '@/components/community/CommunitySubmitForm';
import { getSessionActor } from '@/lib/auth/session';
import { getDb } from '@/lib/auth/db';
import { users } from '@/../db/schema';
import { listOwnCommunityWorks } from '@/lib/community/queries';
import { resolvePublicDisplayName } from '@/lib/identity/publicAuthor';
import { zhCN } from '@/messages/zh-CN';

export const metadata: Metadata = { title: zhCN.communityAdmin.submitTitle, robots: { index: false, follow: false } };

export default async function CommunitySubmitPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams ?? {};
  const initialDesignId = typeof query.designId === 'string' ? query.designId.slice(0, 100) : '';
  const workId = typeof query.workId === 'string' ? query.workId.slice(0, 100) : undefined;
  const next = new URLSearchParams();
  if (initialDesignId) next.set('designId', initialDesignId);
  if (workId) next.set('workId', workId);
  const actor = await getSessionActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent(`/community/submit${next.size ? `?${next}` : ''}`)}`);
  const [account] = await getDb().select({ username: users.username, email: users.email }).from(users)
    .where(and(eq(users.id, actor.userId), eq(users.accountStatus, 'active')));
  if (!account?.email) notFound();
  const work = workId ? (await listOwnCommunityWorks(getDb(), actor.userId)).find((item) => item.id === workId) : null;
  if (workId && (!z.string().uuid().safeParse(workId).success || !work)) notFound();
  const unavailable = work && (work.lifecycleStatus !== 'active' || work.revisions.some((item) => item.status === 'draft' || item.status === 'pending_review'));
  const t = zhCN.communityAdmin.submission;
  return <main id="main" className="workspace-page"><SiteHeader title={work ? '修改并重新投稿' : t.pageTitle} currentPath="/community" subtitle={t.pageSubtitle} /><div className="workspace-content community-narrow">
    {!actor.emailVerified ? <section className="community-empty"><h2>验证邮箱后即可投稿</h2><p>请先完成账号验证，设计会继续保留。</p><Link href="/account" className="btn-primary">前往账号验证</Link></section>
      : unavailable ? <section className="community-empty"><h2>请先处理当前投稿</h2><p>作品已有草稿、正在审核，或当前已隐藏，暂时不能提交修改版。</p><Link href="/community/mine" className="btn-primary">查看我的投稿</Link></section>
        : <CommunitySubmitForm initialDesignId={initialDesignId} workId={workId} displayName={resolvePublicDisplayName(account.username, account.email)} />}
  </div></main>;
}
