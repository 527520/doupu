'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { AnalyticsConsentBanner, AnalyticsConsentInitialization } from './AnalyticsConsent';

const Placement = createContext<(node: HTMLDivElement | null) => void>(() => {});

/** Keep consent initialization mounted once while the page shell chooses its position. */
export function ConsentPlacement({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return <Placement value={setSlot}><AnalyticsConsentInitialization />{children}<AnalyticsConsentBanner target={slot} /></Placement>;
}

export function ConsentSlot() {
  const setSlot = useContext(Placement);
  return <div className="consent-slot" ref={setSlot} />;
}
