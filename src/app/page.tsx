import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import { AUTHOR_GITHUB_URL, AUTHOR_NAME, SOURCE_REPO_URL } from '@/lib/appInfo';
import OnboardingGuide from '@/components/onboarding/OnboardingGuide';
import HomeAuthNav from '@/components/layout/HomeAuthNav';
import ArcSignature from '@/components/ui/ArcSignature';

export default function Home() {
  const { app, home, footer, nav } = zhCN;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-cream px-6 py-10 text-center">
      <section className="flex flex-col items-center gap-4">
        <ArcSignature className="w-32" />
        <h1 className="text-5xl font-semibold tracking-wide text-ink sm:text-6xl">{app.name}</h1>
        <p className="text-xl text-primary-deep">{app.tagline}</p>
        <p className="max-w-xl text-sm leading-6 text-ink-soft">{app.description}</p>
      </section>

      <OnboardingGuide />

      <section className="flex w-full max-w-md flex-col gap-3">
        <Link
          href="/app"
          className="rounded-3xl border-2 border-dashed border-lilac/70 bg-white/60 p-8 text-ink-soft shadow-card transition-colors duration-150 hover:border-primary hover:text-primary-deep"
        >
          {home.uploadHint}
        </Link>
      </section>

      <nav
        aria-label={nav.mainNav}
        className="flex flex-wrap items-center justify-center gap-2 text-sm"
      >
        {(
          [
            ['/app', nav.workbench],
            ['/designs', nav.designs],
            ['/palettes', nav.palettes],
            ['/help', nav.help],
            ['/about', nav.about],
          ] as const
        ).map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className="rounded-full px-4 py-2 font-medium text-ink-soft transition-colors duration-150 hover:bg-primary-soft hover:text-primary-deep"
          >
            {label}
          </Link>
        ))}
        <HomeAuthNav />
      </nav>

      <footer className="mt-auto flex w-full flex-col items-center gap-2 pb-6 text-xs text-ink-soft/80">
        <p>
          {home.openSourceNotice} ·{' '}
          <a
            href={SOURCE_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="link-soft"
          >
            {footer.sourceCode}
          </a>
        </p>
        <p>
          {footer.author(AUTHOR_NAME)} ·{' '}
          <a
            href={AUTHOR_GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="link-soft"
          >
            {footer.authorGithub}
          </a>
        </p>
        <p>{footer.icp}</p>
        <p>{footer.attribution}</p>
        <p>
          <Link href="/about" className="hover:underline">
            {footer.privacy}
          </Link>
        </p>
      </footer>
    </main>
  );
}
