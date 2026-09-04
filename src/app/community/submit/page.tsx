import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import CommunitySubmitForm from '@/components/community/CommunitySubmitForm';
import { getSessionActor } from '@/lib/auth/session';
import { zhCN } from '@/messages/zh-CN';

export const metadata: Metadata = { title: zhCN.communityAdmin.submitTitle, robots: { index: false, follow: false } };

export default async function CommunitySubmitPage() {
  const actor = await getSessionActor();
  if (!actor) redirect('/login?next=/community/submit');
  const t = zhCN.communityAdmin.submission;
  return <main id="main" className="workspace-page"><SiteHeader title={t.pageTitle} currentPath="/community" subtitle={t.pageSubtitle} /><div className="workspace-content community-narrow"><CommunitySubmitForm /></div></main>;
}
