'use client';

/** 登录页（spec §F9）：统一错误文案、pending 禁用、成功后跳转。 */
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import FormError from '@/components/auth/FormError';
import { zhCN } from '@/messages/zh-CN';
import { emailSchema } from '@/lib/schemas';
import { loginRedirectTarget } from './loginRedirect';
import { track } from '@/lib/analytics/client';
import { authPageHref } from '@/lib/auth/returnTo';
import { useAuthReturnTo } from '@/components/auth/useAuthReturnTo';

export default function LoginPage() {
  const t = zhCN.authPages;
  const router = useRouter();
  const next = useAuthReturnTo();
  const requestPending = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (requestPending.current) return;
    setError(null);
    if (!emailSchema.safeParse(email).success) {
      setError(t.emailInvalid);
      return;
    }
    if (password.length === 0) {
      setError(t.required);
      return;
    }
    requestPending.current = true;
    setPending(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        track({ name: 'login_succeeded', properties: {} });
        router.push(loginRedirectTarget());
        return;
      }
      const body = await res.json().catch(() => null);
      const message = body?.error?.message;
      if (body?.error?.code === 'RATE_LIMITED') {
        setError(zhCN.auth.tooManyRequests);
      } else if (body?.error?.code === 'VALIDATION') {
        setError(zhCN.auth.invalidCredentials);
      } else {
        setError(message || zhCN.auth.invalidCredentials);
      }
    } catch {
      setError(t.networkError);
    } finally {
      requestPending.current = false;
      setPending(false);
    }
  };

  const field = 'input-field';

  return (
    <AuthShell title={t.loginTitle}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormError message={error} />
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
          {t.email}
          <input
            type="email"
            autoComplete="email"
            disabled={pending}
            className={field}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
          {t.password}
          <input
            type="password"
            autoComplete="current-password"
            disabled={pending}
            className={field}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? '…' : t.loginSubmit}
        </button>
        <div className="flex justify-between text-sm">
          <Link href={authPageHref('register', next)} className="link-soft">
            {t.noAccount}
          </Link>
          <Link href={authPageHref('forgot-password', next)} className="link-soft">
            {t.forgotTitle}
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
