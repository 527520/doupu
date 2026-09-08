'use client';

/** 账号菜单（ticket 17）：登录态显示 + 重发验证 + 修改密码 + 注销账号 + 退出登录。 */
import { useEffect, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { emailSchema, passwordSchema, usernameSchema } from '@/lib/schemas';
import Modal from '@/components/ui/Modal';
import Button, { ButtonLink } from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import type { DoupuApi, MeInfo } from '@/lib/sync/api';
import { LIMITS } from '@/lib/appInfo';
import { track } from '@/lib/analytics/client';

interface Props {
  api: DoupuApi;
  me: MeInfo | 'loading';
  onAuthChanged: () => void;
}

export function ChangePasswordDialog({
  api,
  onClose,
  onSuccess,
  onBusyChange,
}: {
  api: DoupuApi;
  onClose: () => void;
  onSuccess: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = zhCN.account;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const submit = async (): Promise<void> => {
    if (pending.current) return;
    setError(null);
    if (!current) { setError(zhCN.authPages.required); return; }
    const parsed = passwordSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.genericError);
      return;
    }
    if (next !== confirm) {
      setError(zhCN.authPages.passwordMismatch);
      return;
    }
    pending.current = true; onBusyChange?.(true); setBusy(true);
    try {
      await api.changePassword(current, next);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.changeFailed);
    } finally {
      pending.current = false; onBusyChange?.(false);
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="modal-form"
    >
      <h3 className="modal-title">{t.changePasswordTitle}</h3>
      <input
        type="password"
        aria-label={t.currentPassword}
        autoComplete="current-password"
        disabled={busy}
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder={t.currentPassword}
        className="input-field"
      />
      <input
        type="password"
        aria-label={t.newPassword}
        autoComplete="new-password"
        disabled={busy}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder={t.newPassword}
        className="input-field"
      />
      <input
        type="password"
        aria-label={t.confirmPassword}
        autoComplete="new-password"
        disabled={busy}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={t.confirmPassword}
        className="input-field"
      />
      {error && <Notice kind="danger">{error}</Notice>}
      <div className="modal-actions">
        <Button variant="quiet" onClick={onClose} disabled={busy}>{zhCN.designs.cancel}</Button>
        <Button type="submit" variant="primary" icon="check" loading={busy}>{zhCN.designs.save}</Button>
      </div>
    </form>
  );
}

export function DeleteAccountDialog({
  api,
  onClose,
  onSuccess,
  onBusyChange,
}: {
  api: DoupuApi;
  onClose: () => void;
  onSuccess: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = zhCN.account;
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const submit = async (): Promise<void> => {
    if (pending.current || !password) return;
    setError(null);
    pending.current = true; onBusyChange?.(true); setBusy(true);
    try {
      await api.deleteAccount(password);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.genericError);
    } finally {
      pending.current = false; onBusyChange?.(false);
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="modal-form"
    >
      <h3 className="modal-title is-danger">{t.deleteAccountTitle}</h3>
      <p className="modal-copy">{t.deleteAccountHint}</p>
      <input
        type="password"
        aria-label={t.passwordLabel}
        autoComplete="current-password"
        disabled={busy}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t.passwordLabel}
        className="input-field"
      />
      {error && <Notice kind="danger">{error}</Notice>}
      <div className="modal-actions">
        <Button variant="quiet" onClick={onClose} disabled={busy}>{zhCN.designs.cancel}</Button>
        <Button type="submit" variant="dangerSolid" icon="trash" disabled={!password} loading={busy}>{t.deleteConfirm}</Button>
      </div>
    </form>
  );
}

export default function AccountMenu({ api, me, onAuthChanged }: Props) {
  const t = zhCN.account;
  const [showPassword, setShowPassword] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState<{ account: string; value: string } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState('');
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const operations = useRef({ profile: false, resend: false, logout: false });
  const dialogBusy = useRef(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    };
  }, []);

  const verifiedAccount = me !== 'loading' && me.state === 'verified' ? me : null;
  const username = verifiedAccount && usernameDraft?.account === verifiedAccount.email
    ? usernameDraft.value
    : verifiedAccount?.username ?? '';
  const setUsername = (value: string): void => {
    if (verifiedAccount) setUsernameDraft({ account: verifiedAccount.email, value });
  };

  const resend = async (): Promise<void> => {
    if (operations.current.resend || cooldown > 0) return;
    setResendError(null);
    if (!emailSchema.safeParse(resendEmail).success) { setResendError(zhCN.authPages.emailInvalid); return; }
    operations.current.resend = true; setResendBusy(true);
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
    } finally { operations.current.resend = false; setResendBusy(false); }
  };

  const logout = async (): Promise<void> => {
    if (operations.current.logout) return;
    operations.current.logout = true; setLogoutBusy(true); setActionError(null);
    try {
      await api.logout();
      track({ name: 'logout_succeeded', properties: {} });
      onAuthChanged();
    } catch {
      setActionError(zhCN.account.logoutFailed);
    } finally { operations.current.logout = false; setLogoutBusy(false); }
  };

  const saveProfile = async (): Promise<void> => {
    if (operations.current.profile) return;
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) {
      setProfileMessage(parsed.error.issues[0]?.message ?? t.genericError);
      return;
    }
    operations.current.profile = true; setProfileBusy(true);
    setProfileMessage(null);
    try {
      await api.updateProfile(parsed.data);
      setUsername(parsed.data);
      setProfileMessage(t.usernameSaved);
      onAuthChanged();
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : t.genericError);
    } finally {
      operations.current.profile = false;
      setProfileBusy(false);
    }
  };

  if (me === 'loading') return <span role="status" className="text-sm text-ink-soft/80">{zhCN.designs.syncing}</span>;

  if (me.state === 'guest') {
    return (
      <section className="account-menu account-guest">
        <div className="account-section-heading"><span className="account-section-icon" aria-hidden="true">{zhCN.app.name.charAt(0)}</span><div><h2>{t.guestTitle}</h2><p>{t.guestHint}</p></div></div>
        <div className="account-button-row"><ButtonLink variant="primary" icon="user" href="/login">{t.login}</ButtonLink><ButtonLink variant="secondary" href="/register">{t.register}</ButtonLink></div>
      </section>
    );
  }

  return (
    <div className="account-menu">
      {me.state === 'verified' && (
        <section className="account-profile-summary">
          <span className="account-large-avatar">{(username || me.email).charAt(0).toUpperCase()}</span>
          <span><strong>{username || me.email.split('@')[0]}</strong><small title={me.email}>{me.email}</small></span>
          <span className="account-verified">{t.verified}</span>
        </section>
      )}

      {me.state === 'unverified' && (
        <section className="account-form-section">
          <div className="account-section-heading"><div><h2>{t.unverified}</h2><p>{t.unverifiedHint}</p></div></div>
          <div className="account-field-row">
            <input type="email" aria-label={t.resendEmailLabel} value={resendEmail} onChange={(e) => setResendEmail(e.target.value)} placeholder={t.resendEmailLabel} className="input-field" />
            <Button variant="secondary" icon="send" onClick={() => void resend()} disabled={cooldown > 0} loading={resendBusy}>
              {cooldown > 0 ? zhCN.authPages.cooldown(cooldown) : t.resend}
            </Button>
          </div>
        </section>
      )}
      {resendSent && me.state === 'unverified' && <Notice kind="success" compact>{t.resendSent}</Notice>}
      {resendError && <Notice kind="danger" compact>{resendError}</Notice>}

      {me.state === 'verified' && (
        <>
          <section className="account-form-section">
            <div className="account-section-heading"><div><h2>{t.profileTitle}</h2><p>{t.profileHint}</p></div></div>
            <label htmlFor="account-username" className="field-label">{t.username}</label>
            <div className="account-field-row">
              <input id="account-username" className="input-field" value={username} disabled={profileBusy} onChange={(event) => setUsername(event.target.value)} maxLength={LIMITS.usernameLength} placeholder={t.username} />
              <Button variant="primary" icon="check" onClick={() => void saveProfile()} loading={profileBusy}>{t.saveUsername}</Button>
            </div>
            {profileMessage && <Notice kind="info" compact role="status">{profileMessage}</Notice>}
          </section>
          <section className="account-action-section">
            <div className="account-section-heading"><div><h2>{t.securityTitle}</h2><p>{t.securityHint}</p></div></div>
            <div className="account-button-row">
              <Button variant="secondary" icon="lock" onClick={() => setShowPassword(true)}>{t.changePassword}</Button>
              <Button variant="secondary" icon="log-out" onClick={() => void logout()} loading={logoutBusy}>{t.logout}</Button>
            </div>
          </section>
          <section className="account-danger-section">
            <div className="account-section-heading"><div><h2>{t.dangerTitle}</h2><p>{t.deleteAccountHint}</p></div></div>
            <Button variant="danger" icon="trash" onClick={() => setShowDelete(true)}>{t.deleteAccount}</Button>
          </section>
        </>
      )}
      {me.state === 'unverified' && <div className="account-button-row"><Button variant="secondary" icon="log-out" onClick={() => void logout()} loading={logoutBusy}>{t.logout}</Button></div>}
      {actionError && <Notice kind="danger" className="animate-rise">{actionError}</Notice>}
      {actionMessage && <Notice kind="success" className="animate-rise">{actionMessage}</Notice>}

      {showPassword && (
        <Modal label={t.changePasswordTitle} onClose={() => { if (!dialogBusy.current) setShowPassword(false); }} panelClassName="max-w-sm">
          <ChangePasswordDialog
            api={api}
            onClose={() => setShowPassword(false)}
            onBusyChange={(value) => { dialogBusy.current = value; }}
            onSuccess={() => { setShowPassword(false); setActionMessage(t.changeSuccess); }}
          />
        </Modal>
      )}
      {showDelete && (
        <Modal label={t.deleteAccountTitle} onClose={() => { if (!dialogBusy.current) setShowDelete(false); }} panelClassName="max-w-sm border-danger/40">
          <DeleteAccountDialog
            api={api}
            onBusyChange={(value) => { dialogBusy.current = value; }}
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
