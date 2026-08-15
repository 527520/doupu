import { zhCN } from '@/messages/zh-CN';
import { APP_VERSION, AUTHOR_GITHUB_URL, AUTHOR_NAME, ISSUES_URL, SOURCE_REPO_URL } from '@/lib/appInfo';
import Link from 'next/link';

export default function AboutPage() {
  const t = zhCN.about;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">{t.title}</h1>
        <p className="text-sm text-gray-500">v{APP_VERSION}</p>
        <p className="text-sm leading-6 text-gray-700">{t.intro}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.featuresTitle}</h2>
        <ul className="flex list-inside list-disc flex-col gap-1 text-sm text-gray-700">
          {t.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.licenseTitle}</h2>
        <p className="text-sm leading-6 text-gray-700">{t.licenseBody}</p>
        <p className="text-sm">
          <a
            href={SOURCE_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline-offset-4 hover:underline"
          >
            {t.sourceCode}
          </a>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.authorTitle}</h2>
        <p className="text-sm leading-6 text-gray-700">
          {AUTHOR_NAME} ·{' '}
          <a
            href={AUTHOR_GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline-offset-4 hover:underline"
          >
            {t.authorGithub}
          </a>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.feedbackTitle}</h2>
        <p className="text-sm leading-6 text-gray-700">{t.feedbackBody}</p>
        <p className="text-sm">
          <a
            href={ISSUES_URL}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline-offset-4 hover:underline"
          >
            {t.feedbackLink}
          </a>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.privacyTitle}</h2>
        <p className="text-sm leading-6 text-gray-700">{t.privacyBody}</p>
      </section>

      <footer className="flex flex-col gap-2 text-sm text-gray-500">
        <p>{t.icp}</p>
        <Link href="/" className="text-blue-600 underline-offset-4 hover:underline">
          ← 返回首页
        </Link>
      </footer>
    </main>
  );
}
