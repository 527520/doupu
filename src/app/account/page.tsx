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
          {error ? <div role="alert" className="notice notice-danger"><p>{zhCN.account.readFailed}</p><button type="button" className="btn-outline" onClick={() => void load()}>{zhCN.common.retry}</button></div> : <AccountMenu api={api} me={me} onAuthChanged={() => {
            notifyAuthStatusChanged();
            void load();
          }} />}
        </section>
        <aside className="account-status-stack">
          <section className="studio-panel account-status-card">
            <span className="account-status-icon"><Icon name={cloudReady ? 'cloud' : 'folder'} /></span>
            <span className="studio-eyebrow">{zhCN.account.syncTitle}</span>
            <h2>{error ? zhCN.account.statusUnknown : me === 'loading' ? zhCN.account.loading : cloudReady ? zhCN.account.cloudMode : zhCN.account.localMode}</h2>
            <p>{error || me === 'loading' ? zhCN.account.noSyncClaim : cloudReady ? zhCN.account.cloudModeHint : zhCN.account.localModeHint}</p>
          </section>
          <section className="studio-panel account-privacy-card">
            <span className="account-status-icon is-sage"><Icon name="lock" /></span>
            <span className="studio-eyebrow">{zhCN.account.privacyTitle}</span>
            <h2>{zhCN.account.originalPrivate}</h2>
            <p>{zhCN.account.privacyBody}</p>
            <Link href="/privacy" className="link-soft">{zhCN.account.analyticsPreferences}</Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
