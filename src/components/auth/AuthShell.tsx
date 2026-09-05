'use client';

import Link from 'next/link';
import Brand from '@/components/layout/Brand';
import Icon from '@/components/ui/Icon';
import { zhCN } from '@/messages/zh-CN';
import { ConsentSlot } from '@/components/analytics/ConsentPlacement';

export default function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  const t = zhCN.authPages;
  return (
    <main id="main" className="auth-studio-page">
      <section className="auth-story-panel">
        <Brand />
        <div className="auth-story-copy">
          <span className="studio-eyebrow">{t.storyKicker}</span>
          <h2>{t.storyTitle}</h2>
          <p>{t.storyBody}</p>
          <div><span><Icon name="lock" size={16} />{t.localProcessing}</span><span><Icon name="cloud" size={16} />{t.cloudProjects}</span></div>
        </div>
      </section>
      <section className="auth-form-column">
        <div className="auth-mobile-brand"><Brand compact /></div>
        <ConsentSlot />
        <div className="auth-form-card">
          <header><h1>{title}</h1><p>{t.formHint}</p></header>
          {children}
        </div>
        <Link href="/" className="auth-back-link"><Icon name="arrow" size={15} />{zhCN.nav.home}</Link>
      </section>
    </main>
  );
}
