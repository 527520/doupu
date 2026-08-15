/**
 * Next.js instrumentation（服务启动钩子）：
 * - 开发/E2E 无 DATABASE_URL 时初始化进程内 PGlite 数据库（免装 Postgres）。
 * - 生产：APP_URL 必须是 https 地址（验证/重置邮件链接与 Origin 校验依赖它），
 *   缺失或非 https 时 fail-fast，避免发出指向 localhost 的邮件链接。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NODE_ENV === 'production') {
      const appUrl = process.env.APP_URL;
      if (!appUrl || !appUrl.startsWith('https://')) {
        throw new Error('APP_URL must be an https URL in production (e.g. https://your-domain)');
      }
    }
    const { ensureFallbackDb } = await import('@/lib/auth/db');
    await ensureFallbackDb();
  }
}
