'use client';

/** 邮箱验证页（spec §F9、边界 E30）：读取 ?token=，POST 验证；失败统一文案 + 重发入口（60s 冷却）。 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import Notice from '@/components/ui/Notice';
import FormError from '@/components/auth/FormError';
import { zhCN } from '@/messages/zh-CN';

type State = 'loading' | 'success' | 'error';

/** 直接读 window.location.search（dev 下 useSearchParams 可能因路由器未就绪而挂起）。 */
function tokenFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('token');
}

function VerifyInner() {
  const t = zhCN.authPages;
  const token = tokenFromLocation();
  // Keep the server and first client render identical; the URL is unavailable
  // during SSR and is resolved by the effect after hydration.
  const [state, setState] = useState<State>('loading');
  const [resendEmail, setResendEmail] = useState('');
  const [resendPending, setResendPending] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const verificationRef = useRef<{ token: string; result: Promise<boolean> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      queueMicrotask(() => {
        if (!cancelled) setState('error');
      });
      return;
    }
    if (!verificationRef.current || verificationRef.current.token !== token) {
      verificationRef.current = {
        token,
        result: fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).then((response) => response.ok, () => false),
      };
    }
    void verificationRef.current.result.then((ok) => {
      if (!cancelled) setState(ok ? 'success' : 'error');
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const resend = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (cooldown > 0 || resendPending) return;
    setResendPending(true);
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail }),
      });
      setResendDone(true);
      setCooldown(60);
    } catch {
      // 恒成功语义：网络失败也按已发送提示，避免信息泄露
      setResendDone(true);
      setCooldown(60);
    } finally {
      setResendPending(false);
    }
  };

  const field = 'input-field';

  return (
    <AuthShell title={t.verifyTitle}>
      {state === 'loading' && (
        <p role="status" className="text-center text-ink-soft">
          {t.verifyLoading}
        </p>
      )}
      {state === 'success' && (
        <>
          <Notice kind="success" className="mb-4">{t.verifySuccess}</Notice>
          <Link href="/login" className="link-soft block text-center">
            {t.goLogin}
          </Link>
        </>
      )}
      {state === 'error' && (
        <>
          <FormError message={zhCN.auth.linkInvalid} />
          <form onSubmit={resend} noValidate className="mt-4 flex flex-col gap-3">
            <h2 className="text-sm font-medium text-ink-soft">{t.resendTitle}</h2>
            <input
              type="email"
              aria-label={t.email}
              placeholder={t.email}
              className={field}
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={resendPending || cooldown > 0}
              className="btn-primary w-full"
            >
              {cooldown > 0 ? t.cooldown(cooldown) : t.submit}
            </button>
            {resendDone && <p className="text-sm text-success">{t.resendSent}</p>}
          </form>
        </>
      )}
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return <VerifyInner />;
}
