'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ANALYTICS_CONSENT_COOKIE, type AnalyticsConsent } from '@/lib/analytics/cookies';
import { clearAnalyticsQueue } from '@/lib/analytics/client';
import { track } from '@/lib/analytics/client';
import { surfaceForPath } from './PageViewTracker';
import { zhCN } from '@/messages/zh-CN';

function readPreference(): AnalyticsConsent | null {
  const value = document.cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${ANALYTICS_CONSENT_COOKIE}=`))
    ?.slice(ANALYTICS_CONSENT_COOKIE.length + 1);
  return value === 'granted' || value === 'denied' ? value : null;
}

async function savePreference(status: 'granted' | 'denied' | 'withdrawn'): Promise<void> {
  const response = await fetch('/api/analytics/consent', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error('CONSENT_UPDATE_FAILED');
}

export function AnalyticsConsentBanner() {
  const t = zhCN.communityAdmin.analytics;
  const [preference, setPreference] = useState<AnalyticsConsent | 'loading' | null>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setPreference(readPreference()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  if (preference !== null) return null;

  const choose = async (status: AnalyticsConsent) => {
    setSaving(true);
    setError(false);
    try {
      await savePreference(status);
      if (status === 'denied') clearAnalyticsQueue();
      if (status === 'granted') {
        track({ name: 'page_viewed', properties: { surface: surfaceForPath(window.location.pathname) } });
      }
      setPreference(status);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="analytics-consent" aria-label={t.bannerLabel}>
      <div>
        <strong>{t.bannerTitle}</strong>
        <p>{t.bannerBody}</p>
        <Link href="/privacy" className="link-soft">{t.learnMore}</Link>
        {error && <p role="alert" className="analytics-consent-error">{t.saveFailed}</p>}
      </div>
      <div className="analytics-consent-actions">
        <button type="button" className="btn-outline" disabled={saving} onClick={() => void choose('denied')}>{t.reject}</button>
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void choose('granted')}>{t.grant}</button>
      </div>
    </aside>
  );
}

export function AnalyticsConsentSettings() {
  const t = zhCN.communityAdmin.analytics;
  const [preference, setPreference] = useState<AnalyticsConsent | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreference(readPreference());
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const choose = async (status: 'granted' | 'denied' | 'withdrawn') => {
    setSaving(true);
    setMessage(null);
    try {
      await savePreference(status);
      if (status !== 'granted') clearAnalyticsQueue();
      const next = status === 'granted' ? 'granted' : 'denied';
      setPreference(next);
      setMessage(status === 'withdrawn' ? t.withdrawn : t.saved);
    } catch {
      setMessage(t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="info-card analytics-settings" aria-labelledby="analytics-settings-title">
      <h2 id="analytics-settings-title">{t.settingsTitle}</h2>
      <p>{ready ? t.currentStatus(preference === 'granted' ? t.granted : preference === 'denied' ? t.denied : t.unset) : t.loading}</p>
      <div>
        <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={() => void choose('granted')}>{t.agree}</button>
        {preference === 'granted' ? (
          <button type="button" className="btn-danger-outline btn-sm" disabled={saving} onClick={() => void choose('withdrawn')}>{t.withdraw}</button>
        ) : (
          <button type="button" className="btn-outline btn-sm" disabled={saving} onClick={() => void choose('denied')}>{t.reject}</button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
