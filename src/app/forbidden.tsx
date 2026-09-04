import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';

export default function ForbiddenPage() {
  const t = zhCN.communityAdmin.forbidden;
  return (
    <main id="main" className="flex min-h-svh items-center justify-center p-6">
      <section className="card-surface max-w-md p-8 text-center">
        <span className="studio-eyebrow">{t.eyebrow}</span>
        <h1 className="page-title mt-3">{t.title}</h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">{t.body}</p>
        <Link href="/" className="btn-outline mt-5">{t.backHome}</Link>
      </section>
    </main>
  );
}
