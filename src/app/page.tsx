import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import { AUTHOR_GITHUB_URL, AUTHOR_NAME, SOURCE_REPO_URL } from '@/lib/appInfo';
import OnboardingGuide from '@/components/onboarding/OnboardingGuide';
import HomeAuthNav from '@/components/layout/HomeAuthNav';

export default function Home() {
  const { app, home, footer, nav } = zhCN;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-6 py-10 text-center">
      <section className="flex flex-col items-center gap-4">
        <h1 className="text-5xl font-bold tracking-wide sm:text-6xl">{app.name}</h1>
        <p className="text-xl text-gray-600">{app.tagline}</p>
        <p className="max-w-xl text-sm leading-6 text-gray-500">{app.description}</p>
      </section>

      <OnboardingGuide />

      <section className="flex w-full max-w-md flex-col gap-3">
        <Link
          href="/app"
          className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-gray-500 transition-colors hover:border-blue-400 hover:text-blue-600"
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
            className="rounded-full px-4 py-2 font-medium text-gray-600 transition-colors duration-150 hover:bg-blue-50 hover:text-blue-600"
          >
            {label}
          </Link>
        ))}
        <HomeAuthNav />
      </nav>

      <footer className="mt-auto flex w-full flex-col items-center gap-2 pb-6 text-xs text-gray-400">
        <p>
          {home.openSourceNotice} ·{' '}
          <a
            href={SOURCE_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-blue-500 underline-offset-4 hover:underline"
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
            className="text-blue-500 underline-offset-4 hover:underline"
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
