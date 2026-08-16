import { zhCN } from '@/messages/zh-CN';
import { APP_VERSION, AUTHOR_GITHUB_URL, AUTHOR_NAME, CONTACT_EMAIL, ISSUES_URL, SOURCE_REPO_URL } from '@/lib/appInfo';
import Link from 'next/link';
import ArcSignature from '@/components/ui/ArcSignature';

export default function AboutPage() {
  const t = zhCN.about;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col items-center gap-2 text-center">
        <ArcSignature className="w-24" />
        <h1 className="text-3xl font-semibold tracking-wide text-ink">{t.title}</h1>
        <p className="text-sm text-ink-soft/80">v{APP_VERSION}</p>
        <p className="text-sm leading-6 text-ink-soft">{t.intro}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t.featuresTitle}</h2>
        <ul className="flex list-inside list-disc flex-col gap-1 text-sm text-ink-soft">
          {t.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t.licenseTitle}</h2>
        <p className="text-sm leading-6 text-ink-soft">{t.licenseBody}</p>
        <p className="text-sm">
          <a href={SOURCE_REPO_URL} target="_blank" rel="noreferrer" className="link-soft">
            {t.sourceCode}
          </a>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t.authorTitle}</h2>
        <p className="text-sm leading-6 text-ink-soft">
          {AUTHOR_NAME} ·{' '}
          <a href={AUTHOR_GITHUB_URL} target="_blank" rel="noreferrer" className="link-soft">
            {t.authorGithub}
          </a>{' '}
          ·{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="link-soft">
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t.feedbackTitle}</h2>
        <p className="text-sm leading-6 text-ink-soft">{t.feedbackBody}</p>
        <p className="text-sm">
          <a href={ISSUES_URL} target="_blank" rel="noreferrer" className="link-soft">
            {t.feedbackLink}
          </a>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t.privacyTitle}</h2>
        <p className="text-sm leading-6 text-ink-soft">{t.privacyBody}</p>
      </section>

      <footer className="flex flex-col gap-2 text-sm text-ink-soft/80">
        {/* 备案（D31）：海外服务器无需 ICP；迁回国内时在此加回一行 icp */}
        <Link href="/" className="link-soft">
          ← 返回首页
        </Link>
      </footer>
    </main>
  );
}
