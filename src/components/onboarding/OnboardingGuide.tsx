'use client';

/**
 * 首页三步引导（spec §F10）：无会话且未手动关闭时显示。
 * 关闭状态存 localStorage（doupu_onboarding_dismissed）；登录态由 useAuthStatus 提供（J-1）。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import { useAuthStatus } from '@/components/account/useAuthStatus';

const DISMISS_KEY = 'doupu_onboarding_dismissed';

export default function OnboardingGuide() {
  const t = zhCN.onboarding;
  const auth = useAuthStatus();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // localStorage 读取放进宏任务：SSR 阶段没有 window，且不在 effect 体内同步 setState。
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      try {
        if (window.localStorage?.getItem(DISMISS_KEY) === '1') setDismissed(true);
      } catch {
        // jsdom 拆掉环境后，未清掉的定时器不能再碰 storage。
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const dismiss = (): void => {
    try {
      window.localStorage?.setItem(DISMISS_KEY, '1');
    } catch {
      // 测试环境拆掉 jsdom 后 storage 可能已经不在。
    }
    setDismissed(true);
  };

  // 只对游客显示；登录态探测中（loading）先不显示，避免闪一下又消失。
  if (dismissed || auth.kind !== 'guest') return null;

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
          className="btn-outline btn-sm"
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
