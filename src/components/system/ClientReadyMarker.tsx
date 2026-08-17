'use client';

import { useEffect } from 'react';

/** Stable browser-test and progressive-enhancement seam: set only after React owns the document. */
export default function ClientReadyMarker() {
  useEffect(() => {
    document.documentElement.dataset.doupuHydrated = 'true';
    return () => {
      delete document.documentElement.dataset.doupuHydrated;
    };
  }, []);
  return null;
}
