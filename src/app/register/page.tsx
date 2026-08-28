'use client';

/** 注册页（spec §F9）：客户端 schema 校验 + 服务端字段级错误展示。 */
import { useState } from 'react';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import Notice from '@/components/ui/Notice';
import FormError from '@/components/auth/FormError';
import { zhCN } from '@/messages/zh-CN';
import { registerSchema } from '@/lib/schemas';
import { DEV_MAIL_LINK_HEADER } from '@/lib/auth/mailMeta';

export default function RegisterPage() {
  const t = zhCN.authPages;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [devMailLink, setDevMailLink] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(t.credentialsInvalid);
      return;
    }
    if (password !== confirm) {
      setError(t.passwordMismatch);
      return;
    }
    setPending(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
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
        <Link href="/login" className="link-soft block text-center">
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
          {t.email}
          <input
            type="email"
            autoComplete="email"
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
          <Link href="/login" className="link-soft">
            {t.hasAccount}
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
