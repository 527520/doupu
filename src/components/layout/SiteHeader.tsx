'use client';

import Link from 'next/link';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { zhCN } from '@/messages/zh-CN';

interface SiteHeaderProps {
  title: string;
  currentPath: string;
  context?: ReactNode;
  primaryActions?: ReactNode;
  overflowActions?: ReactNode;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}

const navigation = [
  ['/app', zhCN.nav.workbench],
  ['/designs', zhCN.nav.designs],
  ['/palettes', zhCN.nav.palettes],
  ['/help', zhCN.nav.help],
  ['/about', zhCN.nav.about],
] as const;

/**
 * 全站页头 module：主操作始终可见，主导航与低频账号操作在窄屏收进
 * 可展开面板；桌面端用 CSS 展开同一份内容，避免重复挂载有状态操作。
 */
export default function SiteHeader({
  title,
  currentPath,
  context,
  primaryActions,
  overflowActions,
  onNavigate,
}: SiteHeaderProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const navigate = (event: MouseEvent<HTMLAnchorElement>, href: string): void => {
    setOverflowOpen(false);
    onNavigate?.(event, href);
  };
  const links = (className: string) => (
    <nav aria-label={zhCN.nav.mainNav} className={className}>
      {navigation.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={currentPath === href ? 'page' : undefined}
          onClick={(event) => navigate(event, href)}
          className="rounded-full px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary-deep aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary-deep"
        >
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <header className="site-header border-b border-lilac/40 pb-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Link
          href="/"
          onClick={(event) => navigate(event, '/')}
          className="shrink-0 rounded-full px-2 py-1 text-sm font-semibold text-primary-deep hover:bg-primary-soft"
        >
          {zhCN.app.name}
        </Link>
        <span aria-hidden="true" className="text-lilac-deep">/</span>
        <h1 className="min-w-0 truncate text-lg font-semibold text-ink">{title}</h1>
        {context && <div className="min-w-0 text-xs text-ink-soft">{context}</div>}
      </div>

      {primaryActions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{primaryActions}</div>}

      {links('hidden w-full flex-wrap items-center gap-1 md:flex md:w-auto')}

      <div className="site-overflow relative md:ml-auto">
        <button
          type="button"
          aria-expanded={overflowOpen}
          aria-controls="site-overflow-panel"
          onClick={() => setOverflowOpen((open) => !open)}
          className="btn-outline px-3 py-2 text-xs md:hidden"
        >
          {zhCN.nav.more}
        </button>
        <div
          id="site-overflow-panel"
          data-testid="site-overflow-panel"
          className={`${overflowOpen ? 'flex' : 'hidden'} site-overflow-panel absolute right-0 top-full z-20 mt-2 min-w-56 flex-col gap-2 rounded-2xl border border-lilac/40 bg-white p-2 shadow-soft md:static md:mt-0 md:flex md:min-w-0 md:flex-row md:border-0 md:bg-transparent md:p-0 md:shadow-none`}
        >
          {links('flex flex-col md:hidden')}
          {overflowActions && <div className="flex flex-wrap items-center gap-2 p-1 md:p-0">{overflowActions}</div>}
        </div>
      </div>
    </header>
  );
}
