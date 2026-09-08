'use client';
import type { useAdminCommand } from './useAdminCommand';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import { zhCN } from '@/messages/zh-CN';

/**
 * 管理写入的结果反馈：失败 / 结果未确认（可重试同一请求）/ 冲突（刷新对象）/ 已完成。
 * 放在动作行正下方并 rise 进场，让人一眼看到「刚才那一下」的结果。
 */
export default function AdminCommandNotice({ command, onRefresh }: { command: ReturnType<typeof useAdminCommand>; onRefresh?: () => void }) {
  const t = zhCN.communityAdmin.command;
  if (!command.error && !command.uncertain && !(command.conflict && onRefresh) && !command.succeeded) return null;
  return <div className="admin-command-notice animate-rise">
    {command.error && <Notice kind="danger">{command.error}</Notice>}
    {command.uncertain && <Notice kind="warning" as="div">
      <span>{t.uncertain}</span>
      <Button variant="secondary" size="sm" icon="refresh" disabled={command.busy} onClick={() => void command.retry()}>{t.retry}</Button>
    </Notice>}
    {command.conflict && onRefresh && <Button variant="secondary" size="sm" icon="refresh" onClick={onRefresh}>{t.refresh}</Button>}
    {command.succeeded && <Notice kind="success">{t.saved}</Notice>}
  </div>;
}
