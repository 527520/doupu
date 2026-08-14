import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import OnboardingGuide from '@/components/onboarding/OnboardingGuide';

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

      <nav className="flex flex-wrap justify-center gap-6 text-sm text-blue-600 underline-offset-4 hover:underline">
        <Link href="/app">{nav.workbench}</Link>
        <Link href="/designs">{nav.designs}</Link>
        <Link href="/palettes">{nav.palettes}</Link>
        <Link href="/help">{nav.help}</Link>
        <Link href="/about">{nav.about}</Link>
        <Link href="/login">{nav.login}</Link>
      </nav>

      <footer className="mt-auto flex w-full flex-col items-center gap-2 pb-6 text-xs text-gray-400">
        <p>
          {home.openSourceNotice} ·{' '}
          <a
            href="https://github.com/527520/doupu"
            target="_blank"
            rel="noreferrer"
            className="text-blue-500 underline-offset-4 hover:underline"
          >
            {footer.sourceCode}
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
