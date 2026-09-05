'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';

export function useAdminCollection<T>(url: string) {
  const [state, setState] = useState<{ url: string; items: T[]; loading: boolean; error: string | null; nextCursor: string | null }>({ url, items: [], loading: true, error: null, nextCursor: null });
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    setState((previous) => ({ url, items: previous.url === url ? previous.items : [], loading: true, error: null, nextCursor: null }));
    try {
      const response = await fetch(url);
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.items)) throw new Error(body?.error?.message || zhCN.communityAdmin.queueLoadFailed);
      if (request === sequence.current) setState({ url, items: body.items, loading: false, error: null, nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null });
    } catch (caught) {
      if (request === sequence.current) setState((previous) => ({ ...previous, loading: false, error: caught instanceof Error ? caught.message : zhCN.communityAdmin.queueLoadFailed }));
    }
  }, [url]);
  useEffect(() => {
    const requestSequence = sequence;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => { window.clearTimeout(timer); requestSequence.current++; };
  }, [reload]);
  return { items: state.url === url ? state.items : [], loading: state.url !== url || state.loading,
    error: state.url === url ? state.error : null, nextCursor: state.url === url ? state.nextCursor : null, reload };
}
