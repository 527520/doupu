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
        className="input-field"
      />
      <input
        type="password"
        aria-label={t.newPassword}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder={t.newPassword}
        className="input-field"
      />
      <input
        type="password"
        aria-label={t.confirmPassword}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={t.confirmPassword}
        className="input-field"
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="btn-outline btn-sm">
          {zhCN.designs.cancel}
        </button>
        <button type="submit" disabled={busy} className="btn-primary btn-sm">
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
      <h3 className="text-sm font-medium text-danger">{t.deleteAccountTitle}</h3>
      <p className="text-sm text-ink-soft">{t.deleteAccountHint}</p>
      <input
        type="password"
        aria-label={t.passwordLabel}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t.passwordLabel}
        className="input-field"
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="btn-outline btn-sm">
          {zhCN.designs.cancel}
        </button>
        <button type="submit" disabled={busy} className="rounded-full bg-danger px-3 py-1 text-sm text-white transition-colors hover:bg-danger disabled:bg-lilac-soft disabled:text-ink-soft/60">
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

  if (me === 'loading') return <span className="text-sm text-ink-soft/80">{zhCN.designs.syncing}</span>;

  if (me.state === 'guest') {
    return (
      <nav aria-label={t.menuLabel} className="flex items-center gap-3 text-sm">
        <Link href="/login" className="link-soft">
          {t.login}
        </Link>
        <Link href="/register" className="link-soft">
          {t.register}
        </Link>
      </nav>
    );
  }

  return (
    <div className="relative flex max-w-full flex-wrap items-center justify-end gap-2 text-sm">
      {me.state === 'verified' ? (
        <span className="min-w-0 max-w-full truncate sm:max-w-[160px]" title={me.email}>
          {me.email} <span className="text-xs text-success">({t.verified})</span>
        </span>
      ) : (
        <span className="text-warning">{t.unverified}</span>
      )}

      {me.state === 'unverified' && (
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-ink-soft">{t.unverifiedHint}</span>
          <input
            type="email"
            aria-label={t.resendEmailLabel}
            value={resendEmail}
            onChange={(e) => setResendEmail(e.target.value)}
            placeholder={t.resendEmailLabel}
            className="w-full min-w-0 input-compact text-xs sm:w-40"
          />
          <button
            type="button"
            onClick={() => void resend()}
            disabled={cooldown > 0}
            className="btn-outline btn-xs"
          >
            {cooldown > 0 ? zhCN.authPages.cooldown(cooldown) : t.resend}
          </button>
        </div>
      )}
      {resendSent && me.state === 'unverified' && <span role="status" className="text-xs text-success">{t.resendSent}</span>}
      {resendError && (
        <span role="alert" className="text-xs text-danger">
          {resendError}
        </span>
      )}

      {me.state === 'verified' && (
        <>
          <button type="button" onClick={() => setShowPassword(true)} className="btn-outline btn-xs">
            {t.changePassword}
          </button>
          <button type="button" onClick={() => setShowDelete(true)} className="btn-danger-outline btn-xs">
            {t.deleteAccount}
          </button>
        </>
      )}
      <button type="button" onClick={() => void logout()} className="btn-outline btn-xs">
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
        <Modal label={t.deleteAccountTitle} onClose={() => setShowDelete(false)} panelClassName="max-w-sm border-danger/40">
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
