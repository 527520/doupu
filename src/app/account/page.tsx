'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import SiteHeader from '@/components/layout/SiteHeader';
import AccountMenu from '@/components/account/AccountMenu';
import Icon from '@/components/ui/Icon';
import { createDoupuApi, type MeInfo } from '@/lib/sync/api';
import { zhCN } from '@/messages/zh-CN';
import { notifyAuthStatusChanged } from '@/components/account/useAuthStatus';

export default function AccountPage() {
  const api = useMemo(() => createDoupuApi(), []);
  const [me, setMe] = useState<MeInfo | 'loading'>('loading');

  const load = useCallback(async (): Promise<void> => {
    try {
      setMe(await api.me());
    } catch {
      setMe({ state: 'guest' });
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
          <AccountMenu api={api} me={me} onAuthChanged={() => {
            notifyAuthStatusChanged();
            void load();
          }} />
        </section>
        <aside className="account-status-stack">
          <section className="studio-panel account-status-card">
            <span className="account-status-icon"><Icon name={cloudReady ? 'cloud' : 'folder'} /></span>
            <span className="studio-eyebrow">{zhCN.account.syncTitle}</span>
            <h2>{cloudReady ? zhCN.account.cloudMode : zhCN.account.localMode}</h2>
            <p>{cloudReady ? zhCN.account.cloudModeHint : zhCN.account.localModeHint}</p>
          </section>
          <section className="studio-panel account-privacy-card">
            <span className="account-status-icon is-sage"><Icon name="lock" /></span>
            <span className="studio-eyebrow">{zhCN.account.privacyTitle}</span>
            <h2>{zhCN.account.originalPrivate}</h2>
            <p>{zhCN.account.privacyBody}</p>
            <div className="account-privacy-tickets"><span>{zhCN.account.originalPrivate}</span><span>{zhCN.account.projectSync}</span></div>
          </section>
        </aside>
      </div>
    </main>
  );
}
