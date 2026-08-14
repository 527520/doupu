/**
 * Next.js instrumentation（服务启动钩子）：
 * 开发/E2E 无 DATABASE_URL 时初始化进程内 PGlite 数据库（免装 Postgres）。
 * 生产环境（DATABASE_URL 已配置）为无操作。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureFallbackDb } = await import('@/lib/auth/db');
    await ensureFallbackDb();
  }
}
