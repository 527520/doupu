'use client';

/** 保存状态徽标 + 手动保存按钮。 */
import { zhCN } from '@/messages/zh-CN';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'quota' | 'error' | 'unavailable';
export type CloudSaveState = 'pending' | 'syncing' | 'synced';

interface Props {
  state: SaveState;
  onSave: () => void;
  disabled?: boolean;
  cloudState?: CloudSaveState;
  /** 是否已登录：决定「空闲」态文案（已登录不再显示误导性的未登录提示）。 */
  loggedIn: boolean;
}

export default function SaveStatus({ state, cloudState = 'pending', onSave, loggedIn, disabled }: Props) {
  const t = zhCN.workbench;
  const badge: Record<SaveState, { text: string; className: string }> = {
    idle: { text: loggedIn ? t.localSaved : t.localOnly, className: 'text-ink-soft/80' },
    dirty: { text: t.unsaved, className: 'text-amber-700' },
    saving: { text: t.saving, className: 'text-primary-deep' },
    saved: { text: t.saved, className: 'text-green-600' },
    quota: { text: t.quotaError, className: 'text-red-600' },
    error: { text: t.saveFailed, className: 'text-red-600' },
    unavailable: { text: t.unavailable, className: 'text-red-600' },
  };
  const current = badge[state];
  const cloudText: Record<CloudSaveState, string> = {
    pending: t.cloudPending,
    syncing: t.cloudSyncing,
    synced: t.cloudSynced,
  };

  return (
    <div className="flex items-center gap-3">
      <span role="status" className={`text-xs ${current.className}`}>
        {current.text}
      </span>
      {loggedIn && (
        <span role="status" className="text-xs text-ink-soft/80">
          {cloudText[cloudState]}
        </span>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || state === 'saving'}
        className="rounded-full border border-lilac/60 px-3 py-1 text-sm text-ink-soft transition-colors hover:bg-lilac-soft disabled:bg-lilac-soft disabled:text-ink-soft/60"
      >
        {t.save}
      </button>
    </div>
  );
}
