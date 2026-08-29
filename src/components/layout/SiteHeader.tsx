'use client';

import Link from 'next/link';
import { useState, type MouseEvent, type ReactNode } from 'react';
import Brand from '@/components/layout/Brand';
import Icon, { type IconName } from '@/components/ui/Icon';
import { useAuthStatus } from '@/components/account/useAuthStatus';
import { zhCN } from '@/messages/zh-CN';

interface SiteHeaderProps {
  title: string;
  currentPath: string;
  subtitle?: string;
  context?: ReactNode;
  primaryActions?: ReactNode;
  overflowActions?: ReactNode;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}

const primaryNavigation: Array<{ href: string; label: string; shortLabel: string; icon: IconName }> = [
  { href: '/', label: zhCN.workspace.start, shortLabel: zhCN.workspace.startShort, icon: 'home' },
  { href: '/app', label: zhCN.nav.workbench, shortLabel: zhCN.nav.workbench, icon: 'spark' },
  { href: '/designs', label: zhCN.nav.designs, shortLabel: zhCN.workspace.designsShort, icon: 'folder' },
  { href: '/palettes', label: zhCN.nav.palettes, shortLabel: zhCN.workspace.palettesShort, icon: 'palette' },
  { href: '/account', label: zhCN.workspace.account, shortLabel: zhCN.workspace.accountShort, icon: 'user' },
];

const secondaryNavigation: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/help', label: zhCN.workspace.helpAndGuide, icon: 'help' },
  { href: '/about', label: zhCN.nav.about, icon: 'info' },
];

function active(currentPath: string, href: string): boolean {
  return href === '/' ? currentPath === '/' : currentPath === href || currentPath.startsWith(`${href}/`);
}

export default function SiteHeader({
  title,
  currentPath,
  subtitle,
  context,
  primaryActions,
  overflowActions,
  onNavigate,
}: SiteHeaderProps) {
  const auth = useAuthStatus();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const navigate = (event: MouseEvent<HTMLAnchorElement>, href: string): void => {
    setOverflowOpen(false);
    onNavigate?.(event, href);
  };
  const displayName = auth.kind === 'user' ? auth.username || auth.email.split('@')[0] : zhCN.workspace.localCreator;
  const avatar = displayName.trim().charAt(0).toUpperCase() || zhCN.app.name.charAt(0);

  return (
    <>
      <aside className="workspace-sidebar" data-testid="workspace-sidebar">
        <Brand />
        <nav aria-label={zhCN.nav.mainNav} className="workspace-side-nav">
          <span className="workspace-nav-label">{zhCN.workspace.creationSpace}</span>
          {primaryNavigation.slice(0, 4).map((item) => (
            <Link key={item.href} href={item.href} onClick={(event) => navigate(event, item.href)} aria-current={active(currentPath, item.href) ? 'page' : undefined} className="workspace-nav-item">
              <Icon name={item.icon} /><span>{item.label}</span>
            </Link>
          ))}
          <span className="workspace-nav-label">{zhCN.workspace.learn}</span>
          {secondaryNavigation.map((item) => (
            <Link key={item.href} href={item.href} onClick={(event) => navigate(event, item.href)} aria-current={active(currentPath, item.href) ? 'page' : undefined} className="workspace-nav-item">
              <Icon name={item.icon} /><span>{item.label}</span>
            </Link>
          ))}
          <Link href="/account" onClick={(event) => navigate(event, '/account')} aria-current={active(currentPath, '/account') ? 'page' : undefined} className="workspace-nav-item">
            <Icon name="user" /><span>{zhCN.workspace.account}</span>
          </Link>
        </nav>
        <Link href="/about" className="workspace-privacy-note">
          <strong><Icon name="lock" size={15} />{zhCN.workspace.localGeneration}</strong>
          <span>{zhCN.workspace.localGenerationHint}</span>
          <small>{zhCN.workspace.learnPrivacy}<Icon name="arrow" size={14} /></small>
        </Link>
        <Link href="/account" className="workspace-profile">
          <span className="workspace-avatar">{avatar}</span>
          <span><strong>{displayName}</strong><small>{auth.kind === 'user' ? zhCN.workspace.cloudReady : zhCN.workspace.localCreating}</small></span>
          <Icon name="more" size={18} />
        </Link>
      </aside>

      <header className="workspace-topbar">
        <div className="workspace-mobile-brand"><Brand compact /></div>
        <div className="workspace-page-heading">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="workspace-top-actions">
          {context && <div className="workspace-context">{context}</div>}
          {primaryActions}
          {overflowActions && (
            <div className="workspace-overflow">
              <button type="button" className="icon-button" aria-label={zhCN.nav.more} aria-expanded={overflowOpen} aria-controls="site-overflow-panel" onClick={() => setOverflowOpen((open) => !open)}>
                <Icon name="more" />
              </button>
              <div id="site-overflow-panel" data-testid="site-overflow-panel" className={`workspace-overflow-panel${overflowOpen ? ' is-open' : ''}`}>{overflowActions}</div>
            </div>
          )}
          <Link href="/account" className="workspace-top-avatar" aria-label={zhCN.workspace.account}>{avatar}</Link>
        </div>
      </header>

      <nav aria-label={zhCN.nav.mainNav} className="workspace-mobile-nav" data-testid="workspace-mobile-nav">
        {primaryNavigation.map((item) => (
          <Link key={item.href} href={item.href} onClick={(event) => navigate(event, item.href)} aria-current={active(currentPath, item.href) ? 'page' : undefined}>
            <Icon name={item.icon} size={20} /><span>{item.shortLabel}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
