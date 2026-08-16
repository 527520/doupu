'use client';

/**
 * 首页三步引导（spec §F10）：无会话且未手动关闭时显示。
 * 关闭状态存 localStorage（doupu_onboarding_dismissed），会话状态探测 /api/auth/me（401 即游客）。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';

const DISMISS_KEY = 'doupu_onboarding_dismissed';

export default function OnboardingGuide() {
  const t = zhCN.onboarding;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof window !== 'undefined' && window.localStorage.getItem(DISMISS_KEY) === '1') {
          return; // 已关闭过
        }
        const response = await fetch('/api/auth/me');
        if (response.status === 401 && !cancelled) setVisible(true); // 游客才显示
      } catch {
        // 网络失败时不显示引导（避免打扰）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = (): void => {
    if (typeof window !== 'undefined') window.localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  const steps = [
    { title: t.step1Title, body: t.step1Body },
    { title: t.step2Title, body: t.step2Body },
    { title: t.step3Title, body: t.step3Body },
  ];

  return (
    <section aria-label={t.title} className="card-surface w-full max-w-3xl p-6 text-left">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">{t.title}</h2>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full border border-lilac/60 px-3 py-1 text-sm text-ink-soft transition-colors hover:bg-lilac-soft"
        >
          {t.dismiss}
        </button>
      </div>
      <ol className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        {steps.map((step, index) => (
          <li key={step.title} className="flex-1">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-primary-deep">0{index + 1}</p>
            <p className="mb-1 font-medium text-ink">{step.title}</p>
            <p className="text-xs leading-5 text-ink-soft">{step.body}</p>
          </li>
        ))}
      </ol>
      <Link href="/app" className="btn-primary mt-5 inline-flex px-4 py-2 text-sm">
        {t.start}
      </Link>
    </section>
  );
}
