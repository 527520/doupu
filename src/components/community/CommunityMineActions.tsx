'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { track } from '@/lib/analytics/client';
import { zhCN } from '@/messages/zh-CN';
import { isDefiniteCommunityRejection, postCommunityCommand } from './communityCommand';
const t = zhCN.communityAdmin.mineActions;

type Action = 'submit' | 'withdraw_revision' | 'withdraw_work';
interface Attempt { action: Action; url: string; key: string; targetId: string; payload: { expectedVersion: number } }
export default function CommunityMineActions({ workId, version, hasPublished, revision }: {
  workId: string; version: number; hasPublished: boolean;
  revision?: { id: string; version: number; status: string; sourceDesignId: string | null };
}) {
  const router = useRouter();
  const pending = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const completed = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [confirmation, setConfirmation] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const run = async (action: Action) => {
    if (pending.current || completed.current || (attempt.current && attempt.current.action !== action) || (action !== 'withdraw_work' && !revision)) return;
    pending.current = true; setBusy(true); setError(null);
    const current = attempt.current ?? {
      action, key: crypto.randomUUID(), targetId: action === 'withdraw_work' ? workId : revision!.id,
      url: action === 'withdraw_work' ? `/api/community/works/${workId}/withdraw`
        : `/api/community/revisions/${revision!.id}/${action === 'submit' ? 'submit' : 'withdraw'}`,
      payload: { expectedVersion: action === 'withdraw_work' ? version : revision!.version },
    };
    attempt.current = current;
    let accepted = false;
    try {
      const body = await postCommunityCommand(current.url, current.key, current.payload);
      if (body.version !== current.payload.expectedVersion + 1 || (action === 'withdraw_work'
        ? body.workId !== current.targetId || body.lifecycleStatus !== 'withdrawn'
        : body.revisionId !== current.targetId || body.status !== (action === 'submit' ? 'pending_review' : 'withdrawn'))) throw new Error(t.unknown);
      accepted = true; completed.current = true; attempt.current = null; setUncertain(false);
      track({ name: action === 'submit' ? 'community_submission_submitted' : 'community_submission_withdrawn', properties: {} });
      setDone(true); setConfirmation(null);
    } catch (caught) {
      const definite = isDefiniteCommunityRejection(caught);
      if (definite) attempt.current = null;
      setUncertain(!definite);
      setError(caught instanceof Error ? caught.message : t.failed);
    } finally { pending.current = false; setBusy(false); }
    // Refresh failures cannot turn a confirmed write back into a retryable write.
    if (accepted) { try { router.refresh(); } catch { setError(t.refreshState); } }
  };
  const open = (action: Action) => { if (!pending.current && !attempt.current && !completed.current) { setError(null); setConfirmation(action); } };
  const next = new URLSearchParams({ workId });
  if (revision?.sourceDesignId) next.set('designId', revision.sourceDesignId);
  const editable = revision && !['draft', 'pending_review'].includes(revision.status);
  const locked = busy || uncertain || done;
  const feedback = error && <div role="alert" className="notice notice-danger"><p>{error}</p>{uncertain ? <><p>{t.unknown}</p>{!confirmation && <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => attempt.current && void run(attempt.current.action)}>{t.retry}</button>}</> : <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => router.refresh()}>{t.refreshState}</button>}</div>;
  return <div className="community-mine-actions">
    <div className="community-form-actions">
      {revision?.status === 'draft' && <button type="button" className="btn-primary btn-sm" disabled={locked} onClick={() => void run('submit')}>{t.submitDraft}</button>}
      {revision && ['draft', 'pending_review'].includes(revision.status) && <button type="button" className="btn-outline btn-sm" disabled={locked} onClick={() => open('withdraw_revision')}>{revision.status === 'draft' ? t.withdrawDraft : t.withdrawReview}</button>}
      {editable && !locked && <Link href={`/community/submit?${next}`} className="btn-primary btn-sm">{t.edit}</Link>}
      {hasPublished && <button type="button" className="btn-danger-outline btn-sm" disabled={locked} onClick={() => open('withdraw_work')}>{t.withdrawWork}</button>}
    </div>
    {!confirmation && feedback}
    {done && <p role="status">{t.done}<button type="button" className="link-soft" onClick={() => router.refresh()}>{t.refresh}</button></p>}
    {confirmation && <Modal label={confirmation === 'withdraw_work' ? t.withdrawWork : t.withdrawRevision} onClose={() => { if (!pending.current && !attempt.current) setConfirmation(null); }}>
      <div className="community-report-dialog"><h2>{confirmation === 'withdraw_work' ? t.confirmWorkTitle : t.confirmRevisionTitle}</h2>
        <p>{confirmation === 'withdraw_work' ? t.workImpact
          : t.revisionImpact}</p>
        {feedback}<div className="community-form-actions"><button type="button" className="btn-outline" disabled={busy || uncertain} onClick={() => setConfirmation(null)}>{t.keep}</button><button type="button" className="btn-danger-outline" disabled={busy} onClick={() => void run(confirmation)}>{busy ? t.withdrawing : uncertain ? t.retry : t.confirm}</button></div>
      </div>
    </Modal>}
  </div>;
}
