'use client';

/** 找回密码页（spec §F9 防枚举）：恒成功提示 + 60s 冷却。 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import { zhCN } from '@/messages/zh-CN';
import { emailSchema } from '@/lib/schemas';

export default function ForgotPasswordPage() {
  const t = zhCN.authPages;
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!emailSchema.safeParse(email).success) {
      setError('请输入正确的邮箱地址。');
      return;
    }
    if (cooldown > 0 || pending) return;
    setPending(true);
    try {
      // 恒成功语义（防枚举，spec E28/E33）：无论邮箱是否存在均返回 204
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      // 网络失败同样按恒成功提示，避免泄露是否存在账号
    } finally {
      setPending(false);
    }
    setDone(true);
    setCooldown(60);
  };

  const field =
    'w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none';

  return (
    <AuthShell title={t.forgotTitle}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {done && <p role="status" className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{t.forgotSent}</p>}
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
        <button
          type="submit"
          disabled={pending || cooldown > 0}
          className="rounded bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {cooldown > 0 ? t.cooldown(cooldown) : t.submit}
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
