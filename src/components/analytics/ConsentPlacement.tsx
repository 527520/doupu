'use client';

import { usePathname } from 'next/navigation';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { AnalyticsConsentBanner, AnalyticsConsentInitialization } from './AnalyticsConsent';

const Placement = createContext<(node: HTMLDivElement | null) => void>(() => {});

/** Keep consent initialization mounted once while the page shell chooses its position. */
export function ConsentPlacement({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const pathname = usePathname();
  // 管理后台是工作人员的工作区，不在每页底部反复弹统计同意；同意仍可在前台任意页面或账号页处理。
  const suppressed = pathname?.startsWith('/admin') ?? false;
  return <Placement value={setSlot}><AnalyticsConsentInitialization />{children}{!suppressed && <AnalyticsConsentBanner target={slot} />}</Placement>;
}

export function ConsentSlot() {
  const setSlot = useContext(Placement);
  return <div className="consent-slot" ref={setSlot} />;
}
