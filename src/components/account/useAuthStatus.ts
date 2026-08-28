'use client';

/**
 * 登录态探测（J-1）。
 *
 * `/api/auth/me` 的探测此前在 Workbench、HomeAuthNav、OnboardingGuide 里各写一遍，
 * 三处对「401」「网络失败」「响应体缺 email」的处理还各不相同；首页同时渲染
 * 导航与新手引导，等于同一个接口请求两次。
 *
 * 这里收成一个 hook 并共享同一次在途请求：
 * - 401 → guest；
 * - 网络失败 → unknown（区别于 guest：新手引导在网络异常时不打扰用户，
 *   而导航把 unknown 当作未登录处理即可）。
 */
import { useEffect, useState } from 'react';

export type AuthStatus =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'unknown' }
  | { kind: 'user'; email: string };

type Settled = Exclude<AuthStatus, { kind: 'loading' }>;

/** 页面级共享：同一次加载里多个组件只发一次请求。 */
let inflight: Promise<Settled> | null = null;

async function probe(): Promise<Settled> {
  try {
    const response = await fetch('/api/auth/me', { method: 'GET' });
    if (!response.ok) return { kind: 'guest' };
    const body = (await response.json().catch(() => null)) as { email?: string } | null;
    return { kind: 'user', email: body?.email ?? '' };
  } catch {
    return { kind: 'unknown' };
  }
}

function sharedProbe(): Promise<Settled> {
  inflight ??= probe().finally(() => {
    // 请求完成后清空，方便登录/退出后重新探测（下一次挂载会重新发起）。
    inflight = null;
  });
  return inflight;
}

/** 仅测试使用：清掉共享的在途请求，避免用例之间互相影响。 */
export function resetAuthStatusCache(): void {
  inflight = null;
}

export function useAuthStatus(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void sharedProbe().then((settled) => {
      if (!cancelled) setStatus(settled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
