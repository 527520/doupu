'use client';

/**
 * 首页登录态导航（客户端组件）：
 * - 未登录：显示「登录」主按钮；
 * - 已登录：显示账号邮箱 + 「退出登录」（我的设计入口由首页导航常驻提供）。
 * 登录态经 /api/auth/me 探测（401/网络失败均按未登录处理）。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zhCN } from '@/messages/zh-CN';

type AuthState = { kind: 'loading' } | { kind: 'guest' } | { kind: 'user'; email: string };

export default function HomeAuthNav() {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { method: 'GET' })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setAuth({ kind: 'guest' });
          return;
        }
        const body = (await res.json().catch(() => null)) as { email?: string } | null;
        setAuth({ kind: 'user', email: body?.email ?? '' });
      })
      .catch(() => {
        if (!cancelled) setAuth({ kind: 'guest' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setAuth({ kind: 'guest' });
      setLoggingOut(false);
      router.refresh();
    }
  };

  if (auth.kind === 'user') {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="max-w-[180px] truncate rounded-full border border-gray-200 bg-white px-3 py-1.5 text-gray-600" title={auth.email}>
          {auth.email || zhCN.nav.logout}
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          disabled={loggingOut}
          className="rounded-full px-3 py-1.5 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          {zhCN.nav.logout}
        </button>
      </div>
    );
  }

  if (auth.kind === 'guest') {
    return (
      <Link
        href="/login"
        className="rounded-full bg-blue-600 px-5 py-2 font-medium text-white transition-colors duration-150 hover:bg-blue-700"
      >
        {zhCN.nav.login}
      </Link>
    );
  }

  return <span className="px-5 py-2 text-sm text-gray-300">…</span>;
}
