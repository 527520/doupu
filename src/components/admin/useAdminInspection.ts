'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { ApiError } from '@/lib/sync/clientAdapter';

export function useAdminInspection<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({ url: null, data: null, error: null });
  const sequence = useRef(0);
  const activeRead = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    activeRead.current?.abort();
    if (!url) return;
    const controller = new AbortController(); activeRead.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setState({ url, data: null, error: null });
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new ApiError(response.status, 'UNKNOWN', body?.error?.message || zhCN.communityAdmin.queueLoadFailed);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      if (sequence.current === request) setState({ url, data: body, error: null });
    } catch (caught) {
      if (sequence.current === request) setState({ url, data: null, error: controller.signal.aborted ? zhCN.communityAdmin.command.readTimeout : caught instanceof ApiError ? caught.message : zhCN.communityAdmin.queueLoadFailed });
    } finally { window.clearTimeout(timeout); }
  }, [url]);
  useEffect(() => {
    const requestSequence = sequence;
    const reads = activeRead;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => { window.clearTimeout(timer); requestSequence.current++; reads.current?.abort(); };
  }, [reload]);
  return { data: state.url === url ? state.data : null, error: state.url === url ? state.error : null, reload };
}
