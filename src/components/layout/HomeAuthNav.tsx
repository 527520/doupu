'use client';

import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import { useAuthStatus } from '@/components/account/useAuthStatus';

/** 首页保留游客登录捷径；已登录的资料、安全与退出统一在账号页。 */
export default function HomeAuthNav() {
  const auth = useAuthStatus();
  if (auth.kind === 'user') return null;
  if (auth.kind === 'loading') return <span role="status" className="text-sm text-ink-soft">{zhCN.nav.checkingAccount}</span>;
  return <Link href="/login" className="btn-outline">{zhCN.nav.login}</Link>;
}
