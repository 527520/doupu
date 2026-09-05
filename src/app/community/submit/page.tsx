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
  return <main id="main" className="workspace-page"><SiteHeader title={work ? t.editTitle : t.pageTitle} currentPath="/community" subtitle={t.pageSubtitle} /><div className="workspace-content community-narrow">
    {!actor.emailVerified ? <section className="community-empty"><h2>{t.verifyTitle}</h2><p>{t.verifyHelp}</p><Link href="/account" className="btn-primary">{t.verifyAction}</Link></section>
      : unavailable ? <section className="community-empty"><h2>{t.unavailableTitle}</h2><p>{t.unavailableHelp}</p><Link href="/community/mine" className="btn-primary">{t.mine}</Link></section>
        : <CommunitySubmitForm initialDesignId={initialDesignId} workId={workId} displayName={resolvePublicDisplayName(account.username, account.email)} />}
  </div></main>;
}
