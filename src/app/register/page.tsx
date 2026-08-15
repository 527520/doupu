'use client';

/** 注册页（spec §F9）：客户端 schema 校验 + 服务端字段级错误展示。 */
import { useState } from 'react';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
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
      setError('请输入正确的邮箱与 8–72 位密码。');
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
        setError(message || '注册失败，请重试。');
      }
    } catch {
      setError('网络错误，请稍后重试。');
    } finally {
      setPending(false);
    }
  };

  const field =
    'w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none';

  if (done) {
    return (
      <AuthShell title={t.registerTitle}>
        <p role="status" className="mb-4 text-center text-green-700">
          {t.registeredSent}
        </p>
        {devMailLink && (
          <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm">
            <p className="mb-2 text-blue-800">{t.devMailHint}</p>
            <a href={devMailLink} className="break-all text-blue-600 underline underline-offset-2">
              {devMailLink}
            </a>
          </div>
        )}
        <Link href="/login" className="block text-center text-blue-600 hover:underline">
          {t.goLogin}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t.registerTitle}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormError message={error} />
        <label className="flex flex-col gap-1 text-sm text-gray-700">
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
        <label className="flex flex-col gap-1 text-sm text-gray-700">
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
        <label className="flex flex-col gap-1 text-sm text-gray-700">
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
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? '…' : t.registerSubmit}
        </button>
        <div className="text-center text-sm text-blue-600">
          <Link href="/login" className="hover:underline">
            {t.hasAccount}
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
