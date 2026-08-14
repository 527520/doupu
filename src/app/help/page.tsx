import { zhCN } from '@/messages/zh-CN';
import Link from 'next/link';

export default function HelpPage() {
  const t = zhCN.help;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="text-3xl font-bold">{t.title}</h1>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.uploadTitle}</h2>
        <p className="text-sm leading-6 text-gray-700">{t.uploadBody}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.paramsTitle}</h2>
        <p className="text-sm leading-6 text-gray-700">{t.paramsBody}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.seamTitle}</h2>
        <p className="text-sm leading-6 text-gray-700">{t.seamBody}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.exportTitle}</h2>
        <p className="text-sm leading-6 text-gray-700">{t.exportBody}</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.faqTitle}</h2>
        <dl className="flex flex-col gap-4">
          {t.faqs.map((faq) => (
            <div key={faq.q} className="rounded border border-gray-200 p-3">
              <dt className="mb-1 font-medium text-gray-800">{faq.q}</dt>
              <dd className="text-sm leading-6 text-gray-600">{faq.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="text-sm text-gray-500">
        <Link href="/" className="text-blue-600 underline-offset-4 hover:underline">
          ← 返回首页
        </Link>
      </footer>
    </main>
  );
}
