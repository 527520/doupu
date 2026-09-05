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

export function LocalSaveBadge({ state }: { state: SaveState }) {
  const t = zhCN.workbench;
  /**
   * 徽标：可见文字要短（D-8），完整说明走 aria-label/title。
   * 保存失败、配额不足、存储不可用这三种是「必须马上懂」的状态，
   * 由工作台的提示条负责完整表述，这里只给短标签。
   */
  const badge: Record<SaveState, { text: string; full?: string; className: string }> = {
    idle: { text: t.notSaved, className: 'text-ink-soft' },
    dirty: { text: t.unsaved, className: 'text-warning' },
    saving: { text: t.saving, className: 'text-primary-deep' },
    saved: { text: t.saved, className: 'text-success' },
    quota: { text: t.saveFailed, full: t.quotaError, className: 'text-danger' },
    error: { text: t.saveFailed, className: 'text-danger' },
    unavailable: { text: t.saveFailed, full: t.unavailable, className: 'text-danger' },
  };
  const current = badge[state];
  return <span role="status" className={`text-xs ${current.className}`}
    {...(current.full ? { 'aria-label': current.full, title: current.full } : {})}>{current.text}</span>;
}

export default function SaveStatus({ state, cloudState = 'pending', onSave, loggedIn, disabled }: Props) {
  const t = zhCN.workbench;
  const cloudText: Record<CloudSaveState, string> = {
    pending: t.cloudPending,
    syncing: t.cloudSyncing,
    synced: t.cloudSynced,
  };

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <LocalSaveBadge state={state} />
      {loggedIn && (
        <span role="status" className="text-xs text-ink-soft">
          {cloudText[state !== 'saved' && cloudState === 'synced' ? 'pending' : cloudState]}
        </span>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || state === 'saving'}
        className="btn-outline btn-sm"
      >
        {t.save}
      </button>
    </div>
  );
}
