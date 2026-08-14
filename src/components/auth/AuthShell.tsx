'use client';

/** 认证页共用外壳：居中卡片。 */
export default function AuthShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <section className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-5 text-center text-2xl font-bold">{title}</h1>
        {children}
      </section>
    </main>
  );
}
