'use client';

/** 注册页（spec §F9）：客户端 schema 校验 + 服务端字段级错误展示。 */
import { useRef, useState } from 'react';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import Notice from '@/components/ui/Notice';
import FormError from '@/components/auth/FormError';
import { zhCN } from '@/messages/zh-CN';
import { registerSchema } from '@/lib/schemas';
import { DEV_MAIL_LINK_HEADER } from '@/lib/auth/mailMeta';
import { LIMITS } from '@/lib/appInfo';
import { track } from '@/lib/analytics/client';
import { authPageHref } from '@/lib/auth/returnTo';
import { useAuthReturnTo } from '@/components/auth/useAuthReturnTo';

export default function RegisterPage() {
  const t = zhCN.authPages;
  const returnTo = useAuthReturnTo();
  const requestPending = useRef(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [devMailLink, setDevMailLink] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (requestPending.current) return;
    setError(null);
    const parsed = registerSchema.safeParse({ email, password, username });
    if (!parsed.success) {
      setError(t.credentialsInvalid);
      return;
    }
    if (password !== confirm) {
      setError(t.passwordMismatch);
      return;
    }
    requestPending.current = true;
    setPending(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        track({ name: 'auth_registered', properties: {} });
        setDone(true);
        // 开发邮件模式：服务端把验证链接放在响应头里，直接展示给用户（正式环境为 null）
        setDevMailLink(res.headers.get(DEV_MAIL_LINK_HEADER));
        return;
      }
      const body = await res.json().catch(() => null);
      const message = body?.error?.message;
      if (body?.error?.code === 'CONFLICT') {
        setError(zhCN.auth.emailTaken);
      } else if (body?.error?.code === 'RATE_LIMITED') {
        setError(zhCN.auth.tooManyRequests);
      } else {
        setError(message || t.registerFailed);
      }
    } catch {
      setError(t.networkError);
    } finally {
      requestPending.current = false;
      setPending(false);
    }
  };

  const field = 'input-field';

  if (done) {
    return (
      <AuthShell title={t.registerTitle}>
        <Notice kind="success" className="mb-4">{t.registeredSent}</Notice>
        {devMailLink && (
          <div className="mb-4 rounded-xl border border-lilac/40 bg-lilac-soft p-3 text-sm">
            <p className="mb-2 text-ink">{t.devMailHint}</p>
            <a href={devMailLink} className="break-all text-primary-deep underline underline-offset-2">
              {devMailLink}
            </a>
          </div>
        )}
        <Link href={authPageHref('login', returnTo)} className="link-soft block text-center">
          {t.goLogin}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t.registerTitle}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormError message={error} />
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
          {t.usernameOptional}
          <input
            type="text"
            autoComplete="nickname"
            disabled={pending}
            className={field}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={LIMITS.usernameLength}
          />
        </label>
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
            autoComplete="new-password"
            disabled={pending}
            className={field}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
          {t.confirmPassword}
          <input
            type="password"
            autoComplete="new-password"
            disabled={pending}
            className={field}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? '…' : t.registerSubmit}
        </button>
        <div className="text-center text-sm">
          <Link href={authPageHref('login', returnTo)} className="link-soft">
            {t.hasAccount}
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
