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
    <aside className="analytics-consent" aria-label="匿名使用数据偏好">
      <div>
        <strong>是否允许匿名使用数据？</strong>
        <p>同意后，我们只记录功能类别、设备类别和匿名会话，不记录原图、图纸正文、搜索词、完整 IP 或邮箱。拒绝不会影响使用。</p>
        <Link href="/privacy" className="link-soft">查看隐私说明与随时撤回</Link>
        {error && <p role="alert" className="analytics-consent-error">偏好保存失败，请稍后重试。</p>}
      </div>
      <div className="analytics-consent-actions">
        <button type="button" className="btn-outline" disabled={saving} onClick={() => void choose('denied')}>拒绝</button>
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void choose('granted')}>同意匿名统计</button>
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
      <h2 id="analytics-settings-title">匿名分析偏好</h2>
      <p>{ready ? `当前状态：${preference === 'granted' ? t.granted : preference === 'denied' ? t.denied : t.unset}` : t.loading}</p>
      <div>
        <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={() => void choose('granted')}>同意</button>
        {preference === 'granted' ? (
          <button type="button" className="btn-danger-outline btn-sm" disabled={saving} onClick={() => void choose('withdrawn')}>撤回并清除原始数据</button>
        ) : (
          <button type="button" className="btn-outline btn-sm" disabled={saving} onClick={() => void choose('denied')}>拒绝</button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
