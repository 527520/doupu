'use client';

import Link from 'next/link';
import { type MouseEvent, type ReactNode } from 'react';
import Brand from '@/components/layout/Brand';
import Icon, { type IconName } from '@/components/ui/Icon';
import ActionOverflow from '@/components/layout/ActionOverflow';
import { useAuthStatus } from '@/components/account/useAuthStatus';
import { zhCN } from '@/messages/zh-CN';
import { ConsentSlot } from '@/components/analytics/ConsentPlacement';

interface SiteHeaderProps {
  title: string;
  currentPath: string;
  subtitle?: string;
  primaryActions?: ReactNode;
  overflowActions?: ReactNode;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}

const desktopNavigation: Array<{ href: string; label: string; shortLabel: string; icon: IconName }> = [
  { href: '/', label: zhCN.workspace.start, shortLabel: zhCN.workspace.startShort, icon: 'home' },
  { href: '/app', label: zhCN.nav.workbench, shortLabel: zhCN.nav.workbench, icon: 'spark' },
  { href: '/designs', label: zhCN.nav.designs, shortLabel: zhCN.workspace.designsShort, icon: 'folder' },
  { href: '/palettes', label: zhCN.nav.palettes, shortLabel: zhCN.workspace.palettesShort, icon: 'palette' },
  { href: '/community', label: zhCN.communityAdmin.nav.community, shortLabel: zhCN.communityAdmin.nav.community, icon: 'grid' },
  { href: '/account', label: zhCN.workspace.account, shortLabel: zhCN.workspace.accountShort, icon: 'user' },
];

const mobileNavigation = desktopNavigation.filter((item) => item.href !== '/palettes');

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
  primaryActions,
  overflowActions,
  onNavigate,
}: SiteHeaderProps) {
  const auth = useAuthStatus();
  const navigate = (event: MouseEvent<HTMLAnchorElement>, href: string): void => {
    onNavigate?.(event, href);
  };
  const displayName = auth.kind === 'user' ? auth.username || auth.email.split('@')[0] : zhCN.workspace.localCreator;
  const avatar = displayName.trim().charAt(0).toUpperCase() || zhCN.app.name.charAt(0);
  const overflowControl = <ActionOverflow label={zhCN.nav.moreLinks} actions={<>
    {overflowActions}
    <Link href="/palettes" onClick={(event) => navigate(event, '/palettes')}>{zhCN.nav.palettes}</Link>
    <Link href="/help" onClick={(event) => navigate(event, '/help')}>{zhCN.workspace.helpAndGuide}</Link>
    <Link href="/privacy" onClick={(event) => navigate(event, '/privacy')}>{zhCN.workspace.privacyPreferences}</Link>
  </>} />;

  return (
    <>
      <aside className="workspace-sidebar" data-testid="workspace-sidebar">
        <Brand onClick={(event) => navigate(event, '/')} />
        <nav aria-label={zhCN.nav.mainNav} className="workspace-side-nav">
          <span className="workspace-nav-label">{zhCN.workspace.creationSpace}</span>
          {desktopNavigation.slice(0, 5).map((item) => (
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
        </nav>
        <Link href="/privacy" onClick={(event) => navigate(event, '/privacy')} className="workspace-privacy-note">
          <strong><Icon name="lock" size={15} />{zhCN.workspace.localGeneration}</strong>
          <span>{zhCN.workspace.localGenerationHint}</span>
          <small>{zhCN.workspace.learnPrivacy}<Icon name="arrow" size={14} /></small>
        </Link>
        <Link href="/account" onClick={(event) => navigate(event, '/account')} aria-label={zhCN.workspace.account} aria-current={active(currentPath, '/account') ? 'page' : undefined} className="workspace-profile">
          <span className="workspace-avatar">{avatar}</span>
          <span><strong>{displayName}</strong><small>{auth.kind === 'user' ? zhCN.workspace.cloudReady : zhCN.workspace.localCreating}</small></span>
          <Icon name="more" size={18} />
        </Link>
      </aside>

      <header className="workspace-header">
        <div className="workspace-topbar">
          <div className="workspace-mobile-brand"><Brand compact onClick={(event) => navigate(event, '/')} /></div>
          <div className={`workspace-page-heading${currentPath === '/' ? ' home-page-heading' : ''}`}>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="workspace-top-actions">
            {primaryActions}
            {overflowControl}
          </div>
        </div>
      </header>
      <ConsentSlot />

      <nav aria-label={zhCN.nav.mainNav} className="workspace-mobile-nav" data-testid="workspace-mobile-nav">
        {mobileNavigation.map((item) => (
          <Link key={item.href} href={item.href} onClick={(event) => navigate(event, item.href)} aria-current={active(currentPath, item.href) ? 'page' : undefined}>
            <Icon name={item.icon} size={20} /><span>{item.shortLabel}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
