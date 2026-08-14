'use client';

/** 重置密码页（spec §F9、边界 E32）：令牌一次性，成功后提示旧会话失效。 */
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import FormError from '@/components/auth/FormError';
import { zhCN } from '@/messages/zh-CN';
import { passwordSchema } from '@/lib/schemas';

function ResetInner() {
  const t = zhCN.authPages;
  const params = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError(zhCN.auth.linkInvalid);
      return;
    }
    if (!passwordSchema.safeParse(password).success) {
      setError('密码需为 8–72 个字符，且首尾不含空格。');
      return;
    }
    if (password !== confirm) {
      setError(t.passwordMismatch);
      return;
    }
    setPending(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error?.message || zhCN.auth.linkInvalid);
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
      <AuthShell title={t.resetTitle}>
        <p role="status" className="mb-4 text-center text-green-700">
          {t.resetSuccess}
        </p>
        <Link href="/login" className="block text-center text-blue-600 hover:underline">
          {t.goLogin}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t.resetTitle}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormError message={error} />
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
          {pending ? '…' : t.submit}
        </button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthShell title={zhCN.authPages.resetTitle}>
          <p className="text-center text-gray-500">{zhCN.authPages.verifyLoading}</p>
        </AuthShell>
      }
    >
      <ResetInner />
    </Suspense>
  );
}
