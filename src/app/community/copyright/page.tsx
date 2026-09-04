import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import { CONTACT_EMAIL } from '@/lib/appInfo';
import { zhCN } from '@/messages/zh-CN';

export const metadata: Metadata = { title: zhCN.communityAdmin.copyrightTitle };
export default function CommunityCopyrightPage() {
  const t = zhCN.communityAdmin.copyright;
  return <main id="main" className="workspace-page"><SiteHeader title={t.title} currentPath="/community/copyright" subtitle={t.subtitle} /><div className="workspace-content community-narrow prose-policy"><div className="notice notice-warning">{t.warning}</div><h2>{t.licenseTitle}</h2><p>{t.licenseBody}</p><h2>{t.complaintTitle}</h2><p>{t.complaintBeforeEmail} <a className="link-soft" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{t.complaintAfterEmail}</p><h2>{t.appealTitle}</h2><p>{t.appealBody}</p></div></main>;
}
