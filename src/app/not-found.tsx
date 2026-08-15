import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';

/** 404 页面：未匹配路由时的友好提示。 */
export default function NotFound() {
  const t = zhCN.errorPages;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <p className="text-7xl font-bold text-gray-200" aria-hidden="true">
        404
      </p>
      <h1 className="text-2xl font-semibold">{t.notFoundTitle}</h1>
      <p className="max-w-md text-sm leading-6 text-gray-500">{t.notFoundBody}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          {t.backHome}
        </Link>
        <Link
          href="/app"
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
        >
          {t.goWorkbench}
        </Link>
      </div>
    </main>
  );
}
