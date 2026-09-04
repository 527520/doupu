import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import { AnalyticsConsentSettings } from '@/components/analytics/AnalyticsConsent';
import { zhCN } from '@/messages/zh-CN';

export const metadata: Metadata = { title: zhCN.communityAdmin.privacyTitle };

export default function PrivacyPage() {
  const t = zhCN.communityAdmin.privacy;
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title={t.title} currentPath="/privacy" subtitle={t.subtitle} />
      <div className="workspace-content info-page-content">
        <section className="info-hero">
          <div>
            <span className="studio-eyebrow">{t.eyebrow}</span>
            <h2>{t.heroTitle}</h2>
            <p>{t.heroBody}</p>
          </div>
        </section>
        <div className="info-card-grid">
          <section className="info-card"><h2>{t.collectedTitle}</h2><p>{t.collectedBody}</p></section>
          <section className="info-card"><h2>{t.excludedTitle}</h2><p>{t.excludedBody}</p></section>
          <section className="info-card"><h2>{t.retentionTitle}</h2><p>{t.retentionBody}</p></section>
          <section className="info-card"><h2>{t.withdrawalTitle}</h2><p>{t.withdrawalBody}</p></section>
        </div>
        <AnalyticsConsentSettings />
      </div>
    </main>
  );
}
