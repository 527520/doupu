'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ANALYTICS_CONSENT_COOKIE, serializeConsentCookie, serializePendingWithdrawalCookie, type AnalyticsConsent } from '@/lib/analytics/cookies';
import { clearAnalyticsQueue, track } from '@/lib/analytics/client';
import { surfaceForPath } from './PageViewTracker';
import { zhCN } from '@/messages/zh-CN';

type Preference = AnalyticsConsent | 'withdrawn' | null;
const preferenceEvent = 'doupu:analytics-preference';
let requestPending = false;
const stoppedMessage = '已停止采集，但服务器尚未确认清除原始数据。请重试；完成前不能重新同意。';

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
  requestPending = true;
  if (status !== 'granted') {
    document.cookie = serializePendingWithdrawalCookie();
    clearAnalyticsQueue();
  }
  notify();
  let message: string | null = null;
  let error = false;
  try {
    const response = await fetch('/api/analytics/consent', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error('CONSENT_UPDATE_FAILED');
    document.cookie = serializeConsentCookie(status === 'granted' ? 'granted' : 'denied');
    if (status === 'granted') {
      track({ name: 'page_viewed', properties: { surface: surfaceForPath(window.location.pathname) } });
    }
    message = status === 'withdrawn' ? zhCN.communityAdmin.analytics.withdrawn : zhCN.communityAdmin.analytics.saved;
  } catch {
    error = true;
    message = status === 'granted' ? zhCN.communityAdmin.analytics.saveFailed : stoppedMessage;
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

export function AnalyticsConsentBanner() {
  const t = zhCN.communityAdmin.analytics;
  const { preference, ready, saving, message, error } = usePreference();
  if (!ready || preference === 'granted' || preference === 'denied') return null;
  const pending = preference === 'withdrawn';
  return (
    <aside className="analytics-consent" aria-label={t.bannerLabel}>
      <div>
        <strong>{pending ? '匿名分析已停止' : t.bannerTitle}</strong>
        <p>{pending ? stoppedMessage : t.bannerBody}</p>
        <Link href="/privacy" className="link-soft">{t.learnMore}</Link>
        {error && <p role="alert" className="analytics-consent-error">{message}</p>}
      </div>
      <div className="analytics-consent-actions">
        {pending ? <button type="button" className="btn-outline" disabled={saving} onClick={() => void choose('withdrawn')}>重试清除原始数据</button> : <>
          <button type="button" className="btn-outline" disabled={saving} onClick={() => void choose('denied')}>{t.reject}</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void choose('granted')}>{t.grant}</button>
        </>}
      </div>
    </aside>
  );
}

export function AnalyticsConsentSettings() {
  const t = zhCN.communityAdmin.analytics;
  const { preference, ready, saving, message, error } = usePreference();
  const pending = preference === 'withdrawn';
  return (
    <section className="info-card analytics-settings" aria-labelledby="analytics-settings-title">
      <h2 id="analytics-settings-title">{t.settingsTitle}</h2>
      <p>{ready ? t.currentStatus(preference === 'granted' ? t.granted : pending ? '已停止采集，等待清除确认' : preference === 'denied' ? t.denied : t.unset) : t.loading}</p>
      {pending && !message && <p>{stoppedMessage}</p>}
      <div>
        <button type="button" className="btn-primary" disabled={!ready || saving || pending || preference === 'granted'} onClick={() => void choose('granted')}>{t.agree}</button>
        {preference === 'granted' || pending ? (
          <button type="button" className="btn-danger-outline" disabled={!ready || saving} onClick={() => void choose('withdrawn')}>{pending ? '重试清除原始数据' : t.withdraw}</button>
        ) : (
          <button type="button" className="btn-outline" disabled={!ready || saving || preference === 'denied'} onClick={() => void choose('denied')}>{t.reject}</button>
        )}
      </div>
      {message && <p role={error ? 'alert' : 'status'}>{message}</p>}
    </section>
  );
}
