'use client';
import type { useAdminCommand } from './useAdminCommand';
import { zhCN } from '@/messages/zh-CN';

export default function AdminCommandNotice({ command, onRefresh }: { command: ReturnType<typeof useAdminCommand>; onRefresh?: () => void }) {
  const t = zhCN.communityAdmin.command;
  return <>
    {command.error && <p role="alert" className="notice notice-danger">{command.error}</p>}
    {command.uncertain && <div className="notice notice-warning"><p>{t.uncertain}</p><button type="button" className="btn-outline" disabled={command.busy} onClick={() => void command.retry()}>{t.retry}</button></div>}
    {command.conflict && onRefresh && <button type="button" className="btn-outline" onClick={onRefresh}>{t.refresh}</button>}
    {command.succeeded && <p role="status" className="notice">{t.saved}</p>}
  </>;
}
