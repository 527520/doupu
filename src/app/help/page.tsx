import { zhCN } from '@/messages/zh-CN';
import Link from 'next/link';
import ArcSignature from '@/components/ui/ArcSignature';
import SiteHeader from '@/components/layout/SiteHeader';

export default function HelpPage() {
  const t = zhCN.help;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <SiteHeader title={t.title} currentPath="/help" />
      <div className="flex flex-col items-center gap-3 text-center">
        <ArcSignature className="w-24" />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t.uploadTitle}</h2>
        <p className="text-sm leading-6 text-ink-soft">{t.uploadBody}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t.paramsTitle}</h2>
        <p className="text-sm leading-6 text-ink-soft">{t.paramsBody}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t.seamTitle}</h2>
        <p className="text-sm leading-6 text-ink-soft">{t.seamBody}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t.exportTitle}</h2>
        <p className="text-sm leading-6 text-ink-soft">{t.exportBody}</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-ink">{t.faqTitle}</h2>
        <dl className="flex flex-col gap-4">
          {t.faqs.map((faq) => (
            <div key={faq.q} className="card-surface p-4">
              <dt className="mb-1 font-medium text-ink">{faq.q}</dt>
              <dd className="text-sm leading-6 text-ink-soft">{faq.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="text-sm text-ink-soft">
        <Link href="/" className="link-soft">
          ← 返回首页
        </Link>
      </footer>
    </main>
  );
}
