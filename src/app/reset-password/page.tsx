'use client';

/** 重置密码页（spec §F9、边界 E32）：令牌一次性，成功后提示旧会话失效。 */
import { useState } from 'react';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import FormError from '@/components/auth/FormError';
import { zhCN } from '@/messages/zh-CN';
import { passwordSchema } from '@/lib/schemas';

/** 直接读 window.location.search（dev 下 useSearchParams 可能因路由器未就绪而挂起）。 */
function tokenFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('token');
}

function ResetInner() {
  const t = zhCN.authPages;
  const token = tokenFromLocation();
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

  const field = 'input-field';

  if (done) {
    return (
      <AuthShell title={t.resetTitle}>
        <p role="status" className="mb-4 text-center text-green-700">
          {t.resetSuccess}
        </p>
        <Link href="/login" className="link-soft block text-center">
          {t.goLogin}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t.resetTitle}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormError message={error} />
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
          {pending ? '…' : t.submit}
        </button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return <ResetInner />;
}
