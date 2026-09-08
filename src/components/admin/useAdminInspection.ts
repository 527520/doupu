'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { ApiError } from '@/lib/sync/clientAdapter';

/**
 * 详情读取。切换对象时数据清空（避免把上一个对象的材料错挂在新标题下）；
 * 同一对象的 `reload()` 则保留旧数据直到新数据到达（stale-while-revalidate）——
 * 保存标签、刷新状态后材料区不再整体卸载闪回「正在读取…」，画布缩放与开关也不丢。
 */
export function useAdminInspection<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null; refreshing: boolean }>({ url: null, data: null, error: null, refreshing: false });
  const sequence = useRef(0);
  const activeRead = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    activeRead.current?.abort();
    if (!url) return;
    const controller = new AbortController(); activeRead.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setState((previous) => previous.url === url && previous.data ? { ...previous, error: null, refreshing: true } : { url, data: null, error: null, refreshing: false });
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new ApiError(response.status, 'UNKNOWN', body?.error?.message || zhCN.communityAdmin.queueLoadFailed);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      if (sequence.current === request) setState({ url, data: body, error: null, refreshing: false });
    } catch (caught) {
      const message = controller.signal.aborted ? zhCN.communityAdmin.command.readTimeout : caught instanceof ApiError ? caught.message : zhCN.communityAdmin.queueLoadFailed;
      // 刷新失败时保留已有数据，只把错误挂上去；首读失败才回到空。
      if (sequence.current === request) setState((previous) => ({ url, data: previous.url === url ? previous.data : null, error: message, refreshing: false }));
    } finally { window.clearTimeout(timeout); }
  }, [url]);
  useEffect(() => {
    const requestSequence = sequence;
    const reads = activeRead;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => { window.clearTimeout(timer); requestSequence.current++; reads.current?.abort(); };
  }, [reload]);
  const current = state.url === url;
  return { data: current ? state.data : null, error: current ? state.error : null, refreshing: current && state.refreshing, reload };
}
