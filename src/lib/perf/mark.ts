/**
 * 浏览器性能标记（仅用于 E2E 归因）。
 *
 * E2E 03 用 PerformanceObserver 抓 >50ms 长任务并断言「一个都没有」。CI 上会稳定
 * 出现，本机却一个都没有——只报 duration 时无从下手。这里在关键阶段打上标记，
 * 测试失败时把标记与长任务一起打印（公开 annotation 可读），于是不用猜是哪一段。
 *
 * 只在 window 存在且已有 __doupuPerfMarks 时记录：生产用户不会有任何开销。
 */
declare global {
  interface Window {
    __doupuPerfMarks?: Array<{ name: string; at: number }>;
  }
}

export function perfMark(name: string): void {
  if (typeof window === 'undefined') return;
  window.__doupuPerfMarks?.push({ name, at: Math.round(performance.now()) });
}
