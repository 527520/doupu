'use client';

/** 保存状态徽标 + 手动保存按钮。 */
import { zhCN } from '@/messages/zh-CN';

export type SaveState = 'idle' | 'saving' | 'saved' | 'quota' | 'error' | 'unavailable';

interface Props {
  state: SaveState;
  onSave: () => void;
  /** 是否已登录：决定「空闲」态文案（已登录不再显示误导性的未登录提示）。 */
  loggedIn: boolean;
}

export default function SaveStatus({ state, onSave, loggedIn }: Props) {
  const t = zhCN.workbench;
  const badge: Record<SaveState, { text: string; className: string }> = {
    idle: { text: loggedIn ? t.localSaved : t.localOnly, className: 'text-gray-400' },
    saving: { text: t.saving, className: 'text-blue-600' },
    saved: { text: t.saved, className: 'text-green-600' },
    quota: { text: t.quotaError, className: 'text-red-600' },
    error: { text: t.saveFailed, className: 'text-red-600' },
    unavailable: { text: t.unavailable, className: 'text-red-600' },
  };
  const current = badge[state];

  return (
    <div className="flex items-center gap-3">
      <span role="status" className={`text-xs ${current.className}`}>
        {current.text}
      </span>
      <button
        type="button"
        onClick={onSave}
        disabled={state === 'saving'}
        className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
      >
        {t.save}
      </button>
    </div>
  );
}
