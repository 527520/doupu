import type { CommentModerationDeps } from './commentModeration';

/**
 * E2E 假内容安全服务（D50：E2E 不访问腾讯云）。
 * 含「E2E拦截词」→ 拦截，含「E2E风险词」→ 建议复核，其余放行。
 *
 * 通过环境变量而不是模块级 setter 启用：Next dev 里 instrumentation 与路由处理器
 * 各持一份模块实例，启动期注入的 setter 对请求路径不可见。
 */
export const E2E_MODERATION_DEPS: CommentModerationDeps = {
  credentials: { secretId: 'e2e', secretKey: 'e2e', region: 'ap-guangzhou' },
  moderate: async (_creds, request) => {
    const suggestion = request.content.includes('E2E拦截词') ? 'Block' : request.content.includes('E2E风险词') ? 'Review' : 'Pass';
    return {
      suggestion, label: suggestion === 'Pass' ? 'Normal' : 'Ad', subLabel: null,
      score: suggestion === 'Pass' ? 0 : 88, keywords: suggestion === 'Pass' ? [] : ['E2E'],
      requestId: `e2e-${Date.now().toString(36)}`, latencyMs: 1,
    };
  },
};

export function isE2eModerationEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DOUPU_E2E_SEED === '1';
}
