import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import CommunitySubmitForm from '@/components/community/CommunitySubmitForm';
import { getSessionActor } from '@/lib/auth/session';

export const metadata: Metadata = { title: '提交豆社作品', robots: { index: false, follow: false } };

export default async function CommunitySubmitPage() {
  const actor = await getSessionActor();
  if (!actor) redirect('/login?next=/community/submit');
  return <main id="main" className="workspace-page"><SiteHeader title="提交豆社作品" currentPath="/community" subtitle="冻结当前云端设计，审核通过后公开" /><div className="workspace-content community-narrow"><CommunitySubmitForm /></div></main>;
}
