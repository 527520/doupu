'use client';

/**
 * 首页登录态导航（客户端组件）：
 * - 未登录：显示「登录」主按钮；
 * - 已登录：显示账号邮箱 + 「退出登录」（我的设计入口由首页导航常驻提供）。
 * 登录态经 /api/auth/me 探测（401/网络失败均按未登录处理）。
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zhCN } from '@/messages/zh-CN';
import { useAuthStatus, resetAuthStatusCache } from '@/components/account/useAuthStatus';

export default function HomeAuthNav() {
  const router = useRouter();
  // 登录态探测与工作台、新手引导共用（J-1）
  const auth = useAuthStatus();
  const [loggingOut, setLoggingOut] = useState(false);
  /** 退出后本地立即切回未登录显示，不等下一次探测。 */
  const [loggedOut, setLoggedOut] = useState(false);

  const logout = async (): Promise<void> => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch {
      // 网络失败也回退为未登录显示；服务端会话不受影响
    } finally {
      setLoggedOut(true);
      resetAuthStatusCache();
      setLoggingOut(false);
      router.refresh();
    }
  };

  if (auth.kind === 'user' && !loggedOut) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="max-w-[180px] truncate rounded-full border border-lilac/50 bg-white px-3 py-1.5 text-ink-soft" title={auth.email}>
          {auth.email || zhCN.nav.logout}
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          disabled={loggingOut}
          className="rounded-full px-3 py-1.5 text-ink-soft transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
        >
          {zhCN.nav.logout}
        </button>
      </div>
    );
  }

  // guest / unknown（探测失败）都按未登录展示；退出登录后也走这里。
  if (auth.kind === 'guest' || auth.kind === 'unknown' || loggedOut) {
    return (
      <Link
        href="/login"
        className="btn-primary"
      >
        {zhCN.nav.login}
      </Link>
    );
  }

  return (
    <span role="status" className="px-5 py-2 text-sm text-ink-soft/60">
      {zhCN.nav.checkingAccount}
    </span>
  );
}
