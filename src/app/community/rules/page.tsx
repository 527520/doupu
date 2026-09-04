import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import { zhCN } from '@/messages/zh-CN';

export const metadata: Metadata = { title: zhCN.communityAdmin.rulesTitle };
export default function CommunityRulesPage() {
  const t = zhCN.communityAdmin.rulesPage;
  return <main id="main" className="workspace-page"><SiteHeader title={t.title} currentPath="/community/rules" subtitle={t.subtitle} /><div className="workspace-content community-narrow prose-policy"><h2>{t.safeTitle}</h2><p>{t.safeBody}</p><h2>{t.reviewTitle}</h2><p>{t.reviewBody}</p><h2>{t.controlTitle}</h2><p>{t.controlBody}</p><h2>{t.scopeTitle}</h2><p>{t.scopeBody}</p></div></main>;
}
