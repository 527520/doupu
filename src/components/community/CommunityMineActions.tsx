'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { track } from '@/lib/analytics/client';

type Action = 'submit' | 'withdraw_revision' | 'withdraw_work';
export default function CommunityMineActions({ workId, version, hasPublished, revision }: {
  workId: string; version: number; hasPublished: boolean;
  revision?: { id: string; version: number; status: string; sourceDesignId: string | null };
}) {
  const router = useRouter();
  const pending = useRef(false);
  const keys = useRef<Partial<Record<Action, string>>>({});
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const run = async (action: Action) => {
    if (pending.current || done || (action !== 'withdraw_work' && !revision)) return;
    pending.current = true; setBusy(true); setError(null);
    const key = keys.current[action] ?? crypto.randomUUID();
    keys.current[action] = key;
    try {
      const url = action === 'withdraw_work' ? `/api/community/works/${workId}/withdraw`
        : `/api/community/revisions/${revision!.id}/${action === 'submit' ? 'submit' : 'withdraw'}`;
      const response = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ expectedVersion: action === 'withdraw_work' ? version : revision!.version }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? '操作暂时失败，请重试或刷新状态。');
      track({ name: action === 'submit' ? 'community_submission_submitted' : 'community_submission_withdrawn', properties: {} });
      setDone(true); setConfirmation(null); router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败，请重试。');
    } finally { pending.current = false; setBusy(false); }
  };
  const open = (action: Action) => { setError(null); setConfirmation(action); };
  const next = new URLSearchParams({ workId });
  if (revision?.sourceDesignId) next.set('designId', revision.sourceDesignId);
  const editable = revision && !['draft', 'pending_review'].includes(revision.status);
  const feedback = error && <div role="alert" className="notice notice-danger"><p>{error}</p><button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => router.refresh()}>刷新状态</button></div>;
  return <div className="community-mine-actions">
    <div className="community-form-actions">
      {revision?.status === 'draft' && <button type="button" className="btn-primary btn-sm" disabled={busy || done} onClick={() => void run('submit')}>提交草稿审核</button>}
      {revision && ['draft', 'pending_review'].includes(revision.status) && <button type="button" className="btn-outline btn-sm" disabled={busy || done} onClick={() => open('withdraw_revision')}>{revision.status === 'draft' ? '撤回草稿后修改' : '撤回本次审核'}</button>}
      {editable && !done && <Link href={`/community/submit?${next}`} className="btn-primary btn-sm">修改并重新投稿</Link>}
      {hasPublished && <button type="button" className="btn-danger-outline btn-sm" disabled={busy || done} onClick={() => open('withdraw_work')}>撤回整件作品</button>}
    </div>
    {!confirmation && feedback}
    {done && <p role="status">操作已完成，正在刷新投稿状态。<button type="button" className="link-soft" onClick={() => router.refresh()}>刷新</button></p>}
    {confirmation && <Modal label={confirmation === 'withdraw_work' ? '撤回整件作品' : '撤回本次投稿'} onClose={() => { if (!pending.current) setConfirmation(null); }}>
      <div className="community-report-dialog"><h2>{confirmation === 'withdraw_work' ? '撤回整件作品？' : '撤回本次投稿？'}</h2>
        <p>{confirmation === 'withdraw_work' ? '这会隐藏公开作品，并终止本次待审或草稿。已有私人副本会保留，恢复公开需要管理员复核。'
          : '只终止本次草稿或审核，原公开作品保持不变。撤回后可以从自己的设计重新投稿。'}</p>
        {feedback}<div className="community-form-actions"><button type="button" className="btn-outline" disabled={busy} onClick={() => setConfirmation(null)}>暂不撤回</button><button type="button" className="btn-danger-outline" disabled={busy} onClick={() => void run(confirmation)}>{busy ? '撤回中…' : '确认撤回'}</button></div>
      </div>
    </Modal>}
  </div>;
}
