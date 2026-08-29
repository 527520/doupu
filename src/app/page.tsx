import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import { AUTHOR_GITHUB_URL, AUTHOR_NAME, SOURCE_REPO_URL } from '@/lib/appInfo';
import OnboardingGuide from '@/components/onboarding/OnboardingGuide';
import HomeUploadCard from '@/components/upload/HomeUploadCard';
import HomeAuthNav from '@/components/layout/HomeAuthNav';
import SiteHeader from '@/components/layout/SiteHeader';
import Icon from '@/components/ui/Icon';

export default function Home() {
  const { home, footer } = zhCN;
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title={zhCN.workspace.start} currentPath="/" subtitle={zhCN.workspace.homeSubtitle} primaryActions={<HomeAuthNav />} />

      <div className="workspace-content home-studio-grid">
        <section className="home-welcome">
          <div>
            <span className="studio-eyebrow">{home.newPattern}</span>
            <h2>{home.question}</h2>
            <p>{home.startHint}</p>
          </div>
          <div className="home-swoop" aria-hidden="true"><span /><span /><span /><span /></div>
        </section>

        <HomeUploadCard />

        <section className="studio-panel home-library-card">
          <span className="studio-eyebrow">{home.libraryKicker}</span>
          <h2>{home.libraryTitle}</h2>
          <div className="home-library-illustration" aria-hidden="true"><span /><span /><span /></div>
          <p>{home.libraryHint}</p>
          <Link href="/designs" className="btn-outline">{home.openLibrary}<Icon name="arrow" size={16} /></Link>
        </section>

        <div className="home-onboarding"><OnboardingGuide /></div>

        <footer className="home-footer">
          <p>{home.openSourceNotice} · <a href={SOURCE_REPO_URL} target="_blank" rel="noreferrer">{footer.sourceCode}</a></p>
          <p>{footer.author(AUTHOR_NAME)} · <a href={AUTHOR_GITHUB_URL} target="_blank" rel="noreferrer">{footer.authorGithub}</a></p>
          <p>{footer.attribution} · <Link href="/about">{footer.privacy}</Link></p>
        </footer>
      </div>
    </main>
  );
}
