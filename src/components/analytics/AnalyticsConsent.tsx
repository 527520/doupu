'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ANALYTICS_CONSENT_COOKIE, serializeConsentCookie, serializePendingWithdrawalCookie, type AnalyticsConsent } from '@/lib/analytics/cookies';
import { clearAnalyticsQueue, track, setAnalyticsInitialized } from '@/lib/analytics/client';
import { surfaceForPath } from './PageViewTracker';
import { zhCN } from '@/messages/zh-CN';

type Preference = AnalyticsConsent | 'withdrawn' | null;
const preferenceEvent = 'doupu:analytics-preference';
let requestPending = false;
const recovery = zhCN.communityAdmin.consentRecovery;
const stoppedMessage = recovery.stopped;

function readPreference(): Preference {
  const value = document.cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${ANALYTICS_CONSENT_COOKIE}=`))
    ?.slice(ANALYTICS_CONSENT_COOKIE.length + 1);
  return value === 'granted' || value === 'denied' || value === 'withdrawn' ? value : null;
}

function notify(message: string | null = null, error = false) {
  window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: { message, error } }));
}

async function choose(status: AnalyticsConsent | 'withdrawn'): Promise<void> {
  if (requestPending || (status === 'granted' && readPreference() === 'withdrawn')) return;
  if (status === 'granted' && !navigator.locks?.request) {
    setAnalyticsInitialized(false);
    notify(recovery.unsupported, true);
    return;
  }
  requestPending = true;
  setAnalyticsInitialized(false);
  if (status !== 'granted') {
    document.cookie = serializePendingWithdrawalCookie();
    clearAnalyticsQueue();
  } else {
    // 只在明确同意（或恢复仍有效的同意）时记录意图；初始化成功前不采集。
    document.cookie = serializeConsentCookie('granted');
  }
  notify();
  let message: string | null = null;
  let error = false;
  try {
    const save = async () => {
      if (status === 'granted' && readPreference() !== 'granted') return;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch('/api/analytics/consent', {
          method: 'PUT', credentials: 'same-origin', signal: controller.signal,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
        });
        if (!response.ok) throw new Error('CONSENT_UPDATE_FAILED');
        if (status === 'granted') {
          if (readPreference() !== 'granted') return;
          setAnalyticsInitialized(true);
          track({ name: 'page_viewed', properties: { surface: surfaceForPath(window.location.pathname) } });
        } else document.cookie = serializeConsentCookie('denied');
        message = status === 'withdrawn' ? zhCN.communityAdmin.analytics.withdrawn : zhCN.communityAdmin.analytics.saved;
      } finally { window.clearTimeout(timer); }
    };
    // 锁覆盖响应 Cookie 落地：后来的撤回会删除前面 grant 返回的访客。
    if (navigator.locks?.request) await navigator.locks.request('doupu:analytics-consent', save);
    else await save(); // 无锁环境只允许拒绝/撤回，采集始终关闭。
  } catch {
    error = true;
    message = status === 'granted' ? recovery.initializationFailed : stoppedMessage;
  } finally {
    requestPending = false;
    notify(message, error);
  }
}

function usePreference() {
  const [state, setState] = useState<{ preference: Preference; ready: boolean; saving: boolean; message: string | null; error: boolean }>({
    preference: null, ready: false, saving: false, message: null, error: false,
  });
  useEffect(() => {
    const refresh = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      setState((previous) => ({
        preference: readPreference(), ready: true, saving: requestPending,
        message: detail ? detail.message : previous.message,
        error: detail ? detail.error : previous.error,
      }));
    };
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener(preferenceEvent, refresh);
    // Cookies are shared across tabs. Re-read on return without extra identifiers/storage.
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(preferenceEvent, refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return state;
}

export function AnalyticsConsentInitialization() {
  useEffect(() => {
    const timer = window.setTimeout(() => { if (readPreference() === 'granted') void choose('granted'); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

export function AnalyticsConsentBanner({ target }: { target?: HTMLElement | null } = {}) {
  const t = zhCN.communityAdmin.analytics;
  const { preference, ready, saving, message, error } = usePreference();
  if (!ready || (preference === 'granted' && !error) || preference === 'denied') return null;
  const pending = preference === 'withdrawn';
  const banner = (
    <aside className="analytics-consent" aria-label={t.bannerLabel}>
      <div>
        <strong>{pending ? recovery.stoppedTitle : t.bannerTitle}</strong>
        <p>{pending ? stoppedMessage : t.bannerBody}</p>
        <Link href="/privacy" className="link-soft">{t.learnMore}</Link>
        {error && <p role="alert" className="analytics-consent-error">{message}</p>}
      </div>
      <div className="analytics-consent-actions">
        {pending ? <button type="button" className="btn-outline" disabled={saving} onClick={() => void choose('withdrawn')}>{recovery.retry}</button> : <>
          <button type="button" className="btn-outline" disabled={saving} onClick={() => void choose('denied')}>{t.reject}</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void choose('granted')}>{t.grant}</button>
        </>}
      </div>
    </aside>
  );
  return target ? createPortal(banner,target) : banner;
}

export function AnalyticsConsentSettings() {
  const t = zhCN.communityAdmin.analytics;
  const { preference, ready, saving, message, error } = usePreference();
  const pending = preference === 'withdrawn';
  return (
    <section className="info-card analytics-settings" aria-labelledby="analytics-settings-title">
      <h2 id="analytics-settings-title">{t.settingsTitle}</h2>
      <p>{ready ? t.currentStatus(preference === 'granted' ? t.granted : pending ? recovery.pending : preference === 'denied' ? t.denied : t.unset) : t.loading}</p>
      {pending && !message && <p>{stoppedMessage}</p>}
      <div>
        <button type="button" className="btn-primary" disabled={!ready || saving || pending || (preference === 'granted' && !error)} onClick={() => void choose('granted')}>{t.agree}</button>
        {preference === 'granted' || pending ? (
          <button type="button" className="btn-danger-outline" disabled={!ready || saving} onClick={() => void choose('withdrawn')}>{pending ? recovery.retry : t.withdraw}</button>
        ) : (
          <button type="button" className="btn-outline" disabled={!ready || saving || preference === 'denied'} onClick={() => void choose('denied')}>{t.reject}</button>
        )}
      </div>
      {message && <p role={error ? 'alert' : 'status'}>{message}</p>}
    </section>
  );
}
