'use client';

/** 认证页共用外壳（优化票 01）：奶油底 + 居中卡片 + 手绘弧线签名。 */
import Link from 'next/link';
import ArcSignature from '@/components/ui/ArcSignature';
import { zhCN } from '@/messages/zh-CN';

export default function AuthShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-6 bg-cream px-4 py-10">
      <section className="card-surface w-full max-w-md px-6 py-8 sm:px-8">
        <header className="mb-6 flex flex-col items-center gap-2 text-center">
          <ArcSignature className="w-24" />
          <h1 className="page-title">{title}</h1>
        </header>
        {children}
      </section>
      <Link href="/" className="link-soft text-sm">
        ← {zhCN.nav.home}
      </Link>
    </main>
  );
}
