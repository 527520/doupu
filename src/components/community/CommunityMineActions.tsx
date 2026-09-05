'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { track } from '@/lib/analytics/client';
import { zhCN } from '@/messages/zh-CN';
const t = zhCN.communityAdmin.mineActions;

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
      if (!response.ok) throw new Error(body?.error?.message ?? t.requestFailed);
      track({ name: action === 'submit' ? 'community_submission_submitted' : 'community_submission_withdrawn', properties: {} });
      setDone(true); setConfirmation(null); router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.failed);
    } finally { pending.current = false; setBusy(false); }
  };
  const open = (action: Action) => { setError(null); setConfirmation(action); };
  const next = new URLSearchParams({ workId });
  if (revision?.sourceDesignId) next.set('designId', revision.sourceDesignId);
  const editable = revision && !['draft', 'pending_review'].includes(revision.status);
  const feedback = error && <div role="alert" className="notice notice-danger"><p>{error}</p><button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => router.refresh()}>{t.refreshState}</button></div>;
  return <div className="community-mine-actions">
    <div className="community-form-actions">
      {revision?.status === 'draft' && <button type="button" className="btn-primary btn-sm" disabled={busy || done} onClick={() => void run('submit')}>{t.submitDraft}</button>}
      {revision && ['draft', 'pending_review'].includes(revision.status) && <button type="button" className="btn-outline btn-sm" disabled={busy || done} onClick={() => open('withdraw_revision')}>{revision.status === 'draft' ? t.withdrawDraft : t.withdrawReview}</button>}
      {editable && !done && <Link href={`/community/submit?${next}`} className="btn-primary btn-sm">{t.edit}</Link>}
      {hasPublished && <button type="button" className="btn-danger-outline btn-sm" disabled={busy || done} onClick={() => open('withdraw_work')}>{t.withdrawWork}</button>}
    </div>
    {!confirmation && feedback}
    {done && <p role="status">{t.done}<button type="button" className="link-soft" onClick={() => router.refresh()}>{t.refresh}</button></p>}
    {confirmation && <Modal label={confirmation === 'withdraw_work' ? t.withdrawWork : t.withdrawRevision} onClose={() => { if (!pending.current) setConfirmation(null); }}>
      <div className="community-report-dialog"><h2>{confirmation === 'withdraw_work' ? t.confirmWorkTitle : t.confirmRevisionTitle}</h2>
        <p>{confirmation === 'withdraw_work' ? t.workImpact
          : t.revisionImpact}</p>
        {feedback}<div className="community-form-actions"><button type="button" className="btn-outline" disabled={busy} onClick={() => setConfirmation(null)}>{t.keep}</button><button type="button" className="btn-danger-outline" disabled={busy} onClick={() => void run(confirmation)}>{busy ? t.withdrawing : t.confirm}</button></div>
      </div>
    </Modal>}
  </div>;
}
