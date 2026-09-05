'use client';
import { useEffect, useRef } from 'react';

/** Queue → material is a navigation step, not a modal. Keep keyboard focus on the visible step. */
export function useAdminTaskFocus(selectedId: string | null) {
  const queueRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const previousId = useRef<string | null>(null);
  const returnTarget = useRef<HTMLElement | null>(null);
  const rememberTrigger = () => {
    if (document.activeElement instanceof HTMLElement && queueRef.current?.contains(document.activeElement)) returnTarget.current = document.activeElement;
  };
  useEffect(() => {
    if (previousId.current === selectedId) return;
    const wasSelected = previousId.current !== null;
    previousId.current = selectedId;
    if (selectedId) {
      if (document.activeElement instanceof HTMLElement && queueRef.current?.contains(document.activeElement)) {
        returnTarget.current = document.activeElement;
      }
      detailRef.current?.focus();
    } else if (wasSelected) {
      const target = returnTarget.current;
      if (target?.isConnected && !target.matches(':disabled')) target.focus();
      else queueRef.current?.focus();
    }
  }, [selectedId]);
  return { queueRef, detailRef, rememberTrigger };
}
