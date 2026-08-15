'use client';

/** 账号菜单（ticket 17）：登录态显示 + 重发验证 + 修改密码 + 注销账号 + 退出登录。 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import { passwordSchema } from '@/lib/schemas';
import Modal from '@/components/ui/Modal';
import type { DoupuApi, MeInfo } from '@/lib/sync/api';

interface Props {
  api: DoupuApi;
  me: MeInfo | 'loading';
  onAuthChanged: () => void;
}

export function ChangePasswordDialog({
  api,
  onClose,
  onSuccess,
}: {
  api: DoupuApi;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = zhCN.account;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setError(null);
    const parsed = passwordSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.genericError);
      return;
    }
    if (next !== confirm) {
      setError(zhCN.authPages.passwordMismatch);
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.changeFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-2"
    >
      <h3 className="text-sm font-medium">{t.changePasswordTitle}</h3>
      <input
        type="password"
        aria-label={t.currentPassword}
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder={t.currentPassword}
        className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40"
      />
      <input
        type="password"
        aria-label={t.newPassword}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder={t.newPassword}
        className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40"
      />
      <input
        type="password"
        aria-label={t.confirmPassword}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={t.confirmPassword}
        className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="rounded border border-gray-300 px-3 py-1 text-sm">
          {zhCN.designs.cancel}
        </button>
        <button type="submit" disabled={busy} className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:bg-gray-100 disabled:text-gray-400">
          {zhCN.designs.save}
        </button>
      </div>
    </form>
  );
}

export function DeleteAccountDialog({
  api,
  onClose,
  onSuccess,
}: {
  api: DoupuApi;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = zhCN.account;
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await api.deleteAccount(password);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-2"
    >
      <h3 className="text-sm font-medium text-red-700">{t.deleteAccountTitle}</h3>
      <p className="text-sm text-gray-600">{t.deleteAccountHint}</p>
      <input
        type="password"
        aria-label={t.passwordLabel}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t.passwordLabel}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="rounded border border-gray-300 px-3 py-1 text-sm">
          {zhCN.designs.cancel}
        </button>
        <button type="submit" disabled={busy} className="rounded bg-red-600 px-3 py-1 text-sm text-white disabled:bg-gray-100 disabled:text-gray-400">
          {t.deleteConfirm}
        </button>
      </div>
    </form>
  );
}

export default function AccountMenu({ api, me, onAuthChanged }: Props) {
  const t = zhCN.account;
  const [showPassword, setShowPassword] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    };
  }, []);

  const resend = async (): Promise<void> => {
    setResendError(null);
    try {
      await api.resendVerification(resendEmail);
      setResendSent(true);
      setCooldown(60);
      cooldownTimer.current = setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1 && cooldownTimer.current) clearInterval(cooldownTimer.current);
          return prev <= 1 ? 0 : prev - 1;
        });
      }, 1000);
    } catch (e) {
      setResendError(e instanceof Error ? e.message : t.genericError);
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await api.logout();
    } catch {
      // 退出失败也刷新本地状态（幂等接口）
    }
    onAuthChanged();
  };

  if (me === 'loading') return <span className="text-sm text-gray-400">{zhCN.designs.syncing}</span>;

  if (me.state === 'guest') {
    return (
      <nav aria-label={t.menuLabel} className="flex items-center gap-3 text-sm">
        <Link href="/login" className="text-blue-600 underline-offset-4 hover:underline">
          {t.login}
        </Link>
        <Link href="/register" className="text-blue-600 underline-offset-4 hover:underline">
          {t.register}
        </Link>
      </nav>
    );
  }

  return (
    <div className="relative flex items-center gap-3 text-sm">
      {me.state === 'verified' ? (
        <span className="max-w-[160px] truncate" title={me.email}>
          {me.email} <span className="text-xs text-green-600">({t.verified})</span>
        </span>
      ) : (
        <span className="text-amber-600">{t.unverified}</span>
      )}

      {me.state === 'unverified' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{t.unverifiedHint}</span>
          <input
            type="email"
            aria-label={t.resendEmailLabel}
            value={resendEmail}
            onChange={(e) => setResendEmail(e.target.value)}
            placeholder={t.resendEmailLabel}
            className="w-40 rounded border border-gray-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={() => void resend()}
            disabled={cooldown > 0}
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {cooldown > 0 ? zhCN.authPages.cooldown(cooldown) : t.resend}
          </button>
        </div>
      )}
      {resendSent && me.state === 'unverified' && <span role="status" className="text-xs text-green-600">{t.resendSent}</span>}
      {resendError && (
        <span role="alert" className="text-xs text-red-600">
          {resendError}
        </span>
      )}

      {me.state === 'verified' && (
        <>
          <button type="button" onClick={() => setShowPassword(true)} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
            {t.changePassword}
          </button>
          <button type="button" onClick={() => setShowDelete(true)} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
            {t.deleteAccount}
          </button>
        </>
      )}
      <button type="button" onClick={() => void logout()} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
        {t.logout}
      </button>

      {showPassword && (
        <Modal label={t.changePasswordTitle} onClose={() => setShowPassword(false)} panelClassName="max-w-sm">
          <ChangePasswordDialog
            api={api}
            onClose={() => setShowPassword(false)}
            onSuccess={() => setShowPassword(false)}
          />
        </Modal>
      )}
      {showDelete && (
        <Modal label={t.deleteAccountTitle} onClose={() => setShowDelete(false)} panelClassName="max-w-sm border-red-200">
          <DeleteAccountDialog
            api={api}
            onClose={() => setShowDelete(false)}
            onSuccess={() => {
              setShowDelete(false);
              onAuthChanged();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
