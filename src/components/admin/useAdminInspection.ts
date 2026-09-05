'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';

export function useAdminInspection<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({ url: null, data: null, error: null });
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    if (!url) return;
    setState({ url, data: null, error: null });
    try {
      const response = await fetch(url);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || zhCN.communityAdmin.queueLoadFailed);
      if (sequence.current === request) setState({ url, data: body, error: null });
    } catch (caught) {
      if (sequence.current === request) setState({ url, data: null, error: caught instanceof Error ? caught.message : zhCN.communityAdmin.queueLoadFailed });
    }
  }, [url]);
  useEffect(() => {
    const requestSequence = sequence;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => { window.clearTimeout(timer); requestSequence.current++; };
  }, [reload]);
  return { data: state.url === url ? state.data : null, error: state.url === url ? state.error : null, reload };
}
