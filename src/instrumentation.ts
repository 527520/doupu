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
      // 生产未配置任何发信通道：验证/重置邮件只会打印到日志（用户收不到）——显著告警
      if (!process.env.SMTP_HOST && !process.env.SES_SECRET_ID) {
        console.warn(
          '[mail] 生产环境未配置发信通道（SMTP_HOST 或 SES_SECRET_ID），验证/重置邮件仅打印到日志，用户将收不到邮件',
        );
      }
      // 限流表定期清理（优化票 03）：每日删除 25 小时前的过期窗口（窗口小时对齐，>24h 必过期）
      const { cleanupRateLimits } = await import('@/../db/client');
      const { getDb } = await import('@/lib/auth/db');
      const runCleanup = async (): Promise<void> => {
        try {
          const removed = await cleanupRateLimits(getDb(), new Date(Date.now() - 25 * 60 * 60 * 1000));
          if (removed > 0) console.log(`[cleanup] rate_limits 清理 ${removed} 行过期窗口`);
        } catch (error) {
          console.error('[cleanup] rate_limits 清理失败（不阻塞启动）:', error);
        }
      };
      void runCleanup();
      setInterval(() => void runCleanup(), 24 * 60 * 60 * 1000);
    }
    const { ensureFallbackDb } = await import('@/lib/auth/db');
    await ensureFallbackDb();
  }
}
