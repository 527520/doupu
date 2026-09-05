import type { ReactNode } from 'react';
import { zhCN } from '@/messages/zh-CN';

export default function AdminQueueState({ loading, error, empty, reload, children }: {
  loading: boolean; error: string | null; empty: boolean; reload: () => Promise<void>; children: ReactNode;
}) {
  const t = zhCN.communityAdmin.command;
  if (error) return <div className="admin-form-stack"><p role="alert" className="notice notice-danger">{error}</p><button type="button" className="btn-outline" onClick={() => void reload()}>{t.reload}</button></div>;
  if (loading) return <p className="admin-empty" role="status">{t.loading}</p>;
  if (empty) return <p className="admin-empty">{t.empty}</p>;
  return children;
}
