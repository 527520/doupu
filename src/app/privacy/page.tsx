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
        <section className="community-narrow prose-policy" aria-label={t.title}>
          {t.sections.map((section) => <section key={section.title}><h2>{section.title}</h2><p>{section.body}</p></section>)}
        </section>
        <section className="community-narrow" aria-label={t.analyticsSettingsTitle}>
          <h2 className="prose-policy-heading">{t.analyticsSettingsTitle}</h2>
          <AnalyticsConsentSettings />
        </section>
      </div>
    </main>
  );
}
