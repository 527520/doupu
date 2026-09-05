'use client';

import { useEffect, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';

interface Command { url: string; method: 'POST' | 'PATCH'; body: object }
interface Attempt { command: Command; body: string; key: string; success: (body: unknown) => void | Promise<void> }

export function useAdminCommand() {
  const t = zhCN.communityAdmin.command;
  const attempt = useRef<Attempt | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [state, setState] = useState({ busy: false, uncertain: false, error: null as string | null, conflict: false, succeeded: false });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const execute = async (current: Attempt): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ busy: true, uncertain: false, error: null, conflict: false, succeeded: false });
    let reply: unknown;
    let accepted = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(current.command.url, {
        method: current.command.method,
        headers: { 'content-type': 'application/json', 'idempotency-key': current.key },
        body: current.body,
        signal: controller.signal,
      });
      reply = await response.json();
      if (!response.ok) {
        const failure = reply as { error?: { message?: string; code?: string } } | null;
        const uncertain = response.status >= 500 || response.status === 408;
        if (!uncertain) attempt.current = null;
        if (mounted.current) setState({ busy: false, uncertain, error: failure?.error?.message || t.failed, conflict: failure?.error?.code === 'STATE_CONFLICT', succeeded: false });
      } else {
        accepted = true;
        attempt.current = null;
        if (mounted.current) setState({ busy: true, uncertain: false, error: null, conflict: false, succeeded: true });
      }
    } catch {
      if (mounted.current) setState({ busy: false, uncertain: true, error: t.network, conflict: false, succeeded: false });
    } finally {
      window.clearTimeout(timeout);
      if (!accepted) inFlight.current = false;
    }
    // Refresh is separate from the write outcome. Never replay a successful write
    // because its subsequent list refresh failed.
    if (accepted && mounted.current) {
      try { await current.success(reply); }
      catch { if (mounted.current) setState((previous) => ({ ...previous, error: t.refreshFailed })); }
      finally {
        inFlight.current = false;
        if (mounted.current) setState((previous) => ({ ...previous, busy: false }));
      }
    } else if (accepted) inFlight.current = false;
  };
  const run = async <T = unknown>(command: Command, success: (body: T) => void | Promise<void>): Promise<void> => {
    if (inFlight.current || attempt.current) return;
    const current = { command, body: JSON.stringify(command.body), key: crypto.randomUUID(), success: (body: unknown) => success(body as T) };
    attempt.current = current;
    await execute(current);
  };
  const retry = async () => { if (attempt.current) await execute(attempt.current); };
  const resetNotice = () => { if (!attempt.current && !inFlight.current) setState({ busy: false, uncertain: false, error: null, conflict: false, succeeded: false }); };
  return { ...state, locked: state.busy || state.uncertain, run, retry, resetNotice };
}
