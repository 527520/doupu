'use client';
import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';

export default function AdminError({ reset }: { reset: () => void }) {
  const t = zhCN.communityAdmin.readError;
  return <main className="admin-page"><h1>{t.title}</h1><p role="alert" className="notice notice-danger">{t.body}</p><div className="admin-filter-actions"><button type="button" className="btn-primary" onClick={reset}>{t.retry}</button><Link className="btn-outline" href="/admin">{t.back}</Link></div></main>;
}
