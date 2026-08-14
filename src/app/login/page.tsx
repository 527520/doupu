'use client';

/** 登录页（spec §F9）：统一错误文案、pending 禁用、成功后跳转。 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import FormError from '@/components/auth/FormError';
import { zhCN } from '@/messages/zh-CN';
import { emailSchema } from '@/lib/schemas';

export default function LoginPage() {
  const t = zhCN.authPages;
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!emailSchema.safeParse(email).success) {
      setError('请输入正确的邮箱地址。');
      return;
    }
    if (password.length === 0) {
      setError(t.required);
      return;
    }
    setPending(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push('/designs');
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
      setError('网络错误，请稍后重试。');
    } finally {
      setPending(false);
    }
  };

  const field =
    'w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none';

  return (
    <AuthShell title={t.loginTitle}>
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
            autoComplete="current-password"
            className={field}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? '…' : t.loginSubmit}
        </button>
        <div className="flex justify-between text-sm text-blue-600">
          <Link href="/register" className="hover:underline">
            {t.noAccount}
          </Link>
          <Link href="/forgot-password" className="hover:underline">
            {t.forgotTitle}
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
