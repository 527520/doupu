/**
 * Next.js instrumentation（服务启动钩子）：
 * - 开发/E2E 无 DATABASE_URL 时初始化进程内 PGlite 数据库（免装 Postgres）。
 * - 生产：APP_URL 必须是 https 地址（验证/重置邮件链接与 Origin 校验依赖它），
 *   缺失或非 https 时 fail-fast，避免发出指向 localhost 的邮件链接。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NODE_ENV === 'production') {
      const { validateProductionAuthAdapters } = await import('@/lib/auth/runtimeConfig');
      validateProductionAuthAdapters();
      // 限流表定期清理（优化票 03）：每日删除 25 小时前的过期窗口（窗口小时对齐，>24h 必过期）
      const { cleanupRateLimits, cleanupSyncTombstones } = await import('@/../db/client');
      const { getDb } = await import('@/lib/auth/db');
      const runCleanup = async (): Promise<void> => {
        try {
          const removed = await cleanupRateLimits(getDb(), new Date(Date.now() - 25 * 60 * 60 * 1000));
          if (removed > 0) console.log(`[cleanup] rate_limits 清理 ${removed} 行过期窗口`);
          const tombstones = await cleanupSyncTombstones(getDb(), new Date());
          if (tombstones.designs + tombstones.palettes > 0) {
            console.log(`[cleanup] 同步墓碑清理 designs=${tombstones.designs} palettes=${tombstones.palettes}`);
          }
        } catch (error) {
          console.error('[cleanup] rate_limits 清理失败（不阻塞启动）:', error);
        }
        try {
          const { runAnalyticsMaintenance } = await import('@/lib/analytics/maintenance');
          const analytics = await runAnalyticsMaintenance(getDb(), new Date());
          if (!analytics.skipped) {
            console.log(`[cleanup] 分析维护聚合 ${analytics.daysRolledUp} 天，清理 ${analytics.rawEventsDeleted} 条原始事件`);
          }
        } catch (error) {
          console.error('[cleanup] 分析维护失败（不阻塞应用）:', error);
        }
      };
      void runCleanup();
      setInterval(() => void runCleanup(), 24 * 60 * 60 * 1000);
    }
    const { ensureFallbackDb } = await import('@/lib/auth/db');
    await ensureFallbackDb();
  }
}
