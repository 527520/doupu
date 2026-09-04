import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main id="main" className="flex min-h-svh items-center justify-center p-6">
      <section className="card-surface max-w-md p-8 text-center">
        <span className="studio-eyebrow">403 · 权限不足</span>
        <h1 className="page-title mt-3">这里需要更高权限</h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">你的账号已登录，但无权查看或处理这个管理资源。</p>
        <Link href="/" className="btn-outline mt-5">返回首页</Link>
      </section>
    </main>
  );
}
