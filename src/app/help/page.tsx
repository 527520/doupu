import { zhCN } from '@/messages/zh-CN';
import SiteHeader from '@/components/layout/SiteHeader';
import Icon, { type IconName } from '@/components/ui/Icon';

export default function HelpPage() {
  const t = zhCN.help;
  const guides: Array<{ title: string; body: string; icon: IconName }> = [
    { title: t.uploadTitle, body: t.uploadBody, icon: 'upload' },
    { title: t.paramsTitle, body: t.paramsBody, icon: 'sliders' },
    { title: t.paletteTitle, body: t.paletteBody, icon: 'palette' },
    { title: t.seamTitle, body: t.seamBody, icon: 'grid' },
    { title: t.exportTitle, body: t.exportBody, icon: 'download' },
  ];
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title={t.title} currentPath="/help" subtitle={zhCN.workspace.helpAndGuide} />
      <div className="workspace-content info-page-content">
        <section className="info-hero">
          <span className="info-hero-icon"><Icon name="help" size={27} /></span>
          <div><span className="studio-eyebrow">{zhCN.workspace.helpAndGuide}</span><h2>{zhCN.onboarding.title}</h2><p>{zhCN.workspace.homeSubtitle}</p></div>
        </section>
        <div className="info-card-grid">
          {guides.map((guide) => (
            <section key={guide.title} className="info-card"><span><Icon name={guide.icon} /></span><h2>{guide.title}</h2><p>{guide.body}</p></section>
          ))}
        </div>
        <section className="faq-section">
          <span className="studio-eyebrow">{t.faqKicker}</span><h2>{t.faqTitle}</h2>
          <dl>{t.faqs.map((faq) => <div key={faq.q}><dt>{faq.q}</dt><dd>{faq.a}</dd></div>)}</dl>
        </section>
      </div>
    </main>
  );
}
