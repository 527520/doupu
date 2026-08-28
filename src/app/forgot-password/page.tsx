'use client';

/** 找回密码页（spec §F9 防枚举）：恒成功提示 + 60s 冷却。 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import Notice from '@/components/ui/Notice';
import { zhCN } from '@/messages/zh-CN';
import { emailSchema } from '@/lib/schemas';
import { DEV_MAIL_LINK_HEADER } from '@/lib/auth/mailMeta';

export default function ForgotPasswordPage() {
  const t = zhCN.authPages;
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [devMailLink, setDevMailLink] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!emailSchema.safeParse(email).success) {
      setError(t.emailInvalid);
      return;
    }
    if (cooldown > 0 || pending) return;
    setPending(true);
    try {
      // 恒成功语义（防枚举，spec E28/E33）：无论邮箱是否存在均返回 204
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // 开发邮件模式：账号存在时服务端把重置链接放在响应头里（正式环境恒为 null）
      setDevMailLink(res.headers.get(DEV_MAIL_LINK_HEADER));
    } catch {
      // 网络失败同样按恒成功提示，避免泄露是否存在账号
    } finally {
      setPending(false);
    }
    setDone(true);
    setCooldown(60);
  };

  const field = 'input-field';

  return (
    <AuthShell title={t.forgotTitle}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <Notice kind="danger">{error}</Notice>}
        {done && (
          <>
            <Notice kind="success">{t.forgotSent}</Notice>
            {devMailLink && (
              <div className="rounded-xl border border-lilac/40 bg-lilac-soft p-3 text-sm">
                <p className="mb-2 text-ink">{t.devMailHint}</p>
                <a href={devMailLink} className="break-all text-primary-deep underline underline-offset-2">
                  {devMailLink}
                </a>
              </div>
            )}
          </>
        )}
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
        <button
          type="submit"
          disabled={pending || cooldown > 0}
          className="btn-primary w-full"
        >
          {cooldown > 0 ? t.cooldown(cooldown) : t.submit}
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
