'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import SiteHeader from '@/components/layout/SiteHeader';
import AccountMenu from '@/components/account/AccountMenu';
import Icon from '@/components/ui/Icon';
import { createDoupuApi, type MeInfo } from '@/lib/sync/api';
import { zhCN } from '@/messages/zh-CN';
import { notifyAuthStatusChanged } from '@/components/account/useAuthStatus';
import Link from 'next/link';

export default function AccountPage() {
  const api = useMemo(() => createDoupuApi(), []);
  const [me, setMe] = useState<MeInfo | 'loading'>('loading');
  const [error, setError] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(false);
    try {
      setMe(await api.me());
    } catch {
      setError(true);
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const cloudReady = me !== 'loading' && me.state === 'verified';

  return (
    <main id="main" className="workspace-page">
      <SiteHeader title={zhCN.workspace.account} currentPath="/account" subtitle={zhCN.workspace.accountSubtitle} />
      <div className="workspace-content account-page-grid">
        <section className="studio-panel account-primary-card">
          {error ? <div role="alert" className="notice notice-danger"><p>账号信息暂时无法读取，不能确认当前登录状态。</p><button type="button" className="btn-outline" onClick={() => void load()}>重试</button></div> : <AccountMenu api={api} me={me} onAuthChanged={() => {
            notifyAuthStatusChanged();
            void load();
          }} />}
        </section>
        <aside className="account-status-stack">
          <section className="studio-panel account-status-card">
            <span className="account-status-icon"><Icon name={cloudReady ? 'cloud' : 'folder'} /></span>
            <span className="studio-eyebrow">{zhCN.account.syncTitle}</span>
            <h2>{error ? '账号状态待确认' : me === 'loading' ? '正在读取账号…' : cloudReady ? zhCN.account.cloudMode : zhCN.account.localMode}</h2>
            <p>{error || me === 'loading' ? '此处不代表某张图纸已同步，请以工作台上的保存状态为准。' : cloudReady ? zhCN.account.cloudModeHint : zhCN.account.localModeHint}</p>
          </section>
          <section className="studio-panel account-privacy-card">
            <span className="account-status-icon is-sage"><Icon name="lock" /></span>
            <span className="studio-eyebrow">{zhCN.account.privacyTitle}</span>
            <h2>{zhCN.account.originalPrivate}</h2>
            <p>{zhCN.account.privacyBody}</p>
            <Link href="/privacy" className="link-soft">管理匿名统计偏好</Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
