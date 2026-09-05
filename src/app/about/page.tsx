import { zhCN } from '@/messages/zh-CN';
import { APP_VERSION, AUTHOR_GITHUB_URL, AUTHOR_NAME, CONTACT_EMAIL, ISSUES_URL, SOURCE_REPO_URL } from '@/lib/appInfo';
import SiteHeader from '@/components/layout/SiteHeader';
import Icon from '@/components/ui/Icon';
import Link from 'next/link';

export default function AboutPage() {
  const t = zhCN.about;
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title={t.title} currentPath="/about" subtitle={zhCN.workspace.localGenerationHint} />
      <div className="workspace-content info-page-content">
        <section className="about-hero">
          <span className="studio-eyebrow">{zhCN.workspace.brandVersion(APP_VERSION)}</span>
          <h2>{zhCN.app.tagline}</h2><p>{t.intro}</p>
          <div>{t.features.map((feature) => <span key={feature}><Icon name="spark" size={15} />{feature}</span>)}</div>
        </section>
        <div className="about-card-grid">
          <section className="info-card"><span><Icon name="lock" /></span><h2>{t.privacyTitle}</h2><p>{t.privacyBody}</p><Link href="/privacy" className="link-soft">隐私说明与分析偏好</Link></section>
          <section className="info-card"><span><Icon name="info" /></span><h2>{t.licenseTitle}</h2><p>{t.licenseBody}</p><a href={SOURCE_REPO_URL} target="_blank" rel="noreferrer" className="link-soft">{t.sourceCode}</a></section>
          <section className="info-card"><span><Icon name="user" /></span><h2>{t.authorTitle}</h2><p>{AUTHOR_NAME}</p><div className="info-link-row"><a href={AUTHOR_GITHUB_URL} target="_blank" rel="noreferrer">{t.authorGithub}</a><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></div></section>
          <section className="info-card"><span><Icon name="help" /></span><h2>{t.feedbackTitle}</h2><p>{t.feedbackBody}</p><a href={ISSUES_URL} target="_blank" rel="noreferrer" className="link-soft">{t.feedbackLink}</a></section>
        </div>
      </div>
    </main>
  );
}
