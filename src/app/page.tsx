import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import { AUTHOR_GITHUB_URL, AUTHOR_NAME, SOURCE_REPO_URL } from '@/lib/appInfo';
import OnboardingGuide from '@/components/onboarding/OnboardingGuide';
import HomeUploadCard from '@/components/upload/HomeUploadCard';
import HomeAuthNav from '@/components/layout/HomeAuthNav';
import SiteHeader from '@/components/layout/SiteHeader';
import Icon from '@/components/ui/Icon';
import HomeCommunityShelf from '@/components/community/HomeCommunityShelf';
import RecentDesigns from '@/components/designs/RecentDesigns';

export default function Home() {
  const { home, footer } = zhCN;
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title={zhCN.workspace.start} currentPath="/" primaryActions={<HomeAuthNav />} />

      <div className="workspace-content home-studio-grid">
        <div className="home-hero">
        <section className="home-welcome">
          <div>
            <h2><span>{home.questionLead}</span><span>{home.questionEnd}</span></h2>
            <p>{home.startHint}</p>
            <p className="home-privacy"><Icon name="lock" size={16} />{zhCN.workspace.localGeneration}</p>
          </div>
        </section>
        <HomeUploadCard />
        </div>
        <RecentDesigns />
        <HomeCommunityShelf />
        <details className="home-guide"><summary>{zhCN.workspace.helpAndGuide}</summary><OnboardingGuide /><Link href="/help" className="link-action">{home.fullGuide}</Link></details>
        <footer className="home-footer">
          <p>{home.openSourceNotice} · <a href={SOURCE_REPO_URL} target="_blank" rel="noreferrer">{footer.sourceCode}</a></p>
          <p>{footer.author(AUTHOR_NAME)} · <a href={AUTHOR_GITHUB_URL} target="_blank" rel="noreferrer">{footer.authorGithub}</a></p>
          <p>{footer.attribution} · <Link href="/privacy">{footer.privacy}</Link></p>
        </footer>
      </div>
    </main>
  );
}
