import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import ArcSignature from '@/components/ui/ArcSignature';

/** 404 页面：未匹配路由时的友好提示。 */
export default function NotFound() {
  const t = zhCN.errorPages;
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-6 bg-cream px-6 py-16 text-center">
      <p className="text-7xl font-semibold text-lilac/50" aria-hidden="true">
        404
      </p>
      <h1 className="page-title">{t.notFoundTitle}</h1>
      <p className="max-w-md text-sm leading-6 text-ink-soft">{t.notFoundBody}</p>
      <ArcSignature className="w-24" />
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary">
          {t.backHome}
        </Link>
        <Link href="/app" className="btn-outline">
          {t.goWorkbench}
        </Link>
      </div>
    </main>
  );
}
