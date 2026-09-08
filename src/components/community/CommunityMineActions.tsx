'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import Button, { ButtonLink } from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Notice from '@/components/ui/Notice';
import { track } from '@/lib/analytics/client';
import { randomId } from '@/lib/ids';
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
      action, key: randomId(), targetId: action === 'withdraw_work' ? workId : revision!.id,
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
  // 反馈紧挨着动作行：失败 / 结果未确认（可重试同一请求）/ 刷新状态。
  const feedback = error && <div className="admin-command-notice animate-rise"><Notice kind="danger" as="div">
    <span>{error}{uncertain && <><br />{t.unknown}</>}</span>
    {uncertain
      ? (!confirmation && <Button variant="secondary" size="sm" icon="refresh" disabled={busy} onClick={() => attempt.current && void run(attempt.current.action)}>{t.retry}</Button>)
      : <Button variant="secondary" size="sm" icon="refresh" disabled={busy} onClick={() => router.refresh()}>{t.refreshState}</Button>}
  </Notice></div>;
  return <div className="community-mine-actions">
    {/* 一行只有一个主动作：草稿是「提交审核」，已发布是「修改并重新投稿」；撤回一律描边。 */}
    <div className="community-form-actions">
      {hasPublished && <Button variant="danger" size="sm" icon="trash" disabled={locked} onClick={() => open('withdraw_work')}>{t.withdrawWork}</Button>}
      {revision && ['draft', 'pending_review'].includes(revision.status) && <Button variant="secondary" size="sm" icon="undo" disabled={locked} onClick={() => open('withdraw_revision')}>{revision.status === 'draft' ? t.withdrawDraft : t.withdrawReview}</Button>}
      {editable && !locked && <ButtonLink variant="primary" size="sm" icon="edit" href={`/community/submit?${next}`}>{t.edit}</ButtonLink>}
      {revision?.status === 'draft' && <Button variant="primary" size="sm" icon="send" disabled={locked} loading={busy && !confirmation} onClick={() => void run('submit')}>{t.submitDraft}</Button>}
    </div>
    {!confirmation && feedback}
    {done && <Notice kind="success" as="div" className="animate-rise"><span>{t.done}</span><Button variant="quiet" size="sm" icon="refresh" onClick={() => router.refresh()}>{t.refresh}</Button></Notice>}
    {confirmation && <Modal label={confirmation === 'withdraw_work' ? t.withdrawWork : t.withdrawRevision} onClose={() => { if (!pending.current && !attempt.current) setConfirmation(null); }} panelClassName="max-w-md">
      <h2 className="modal-title is-danger">{confirmation === 'withdraw_work' ? t.confirmWorkTitle : t.confirmRevisionTitle}</h2>
      <p className="modal-copy">{confirmation === 'withdraw_work' ? t.workImpact : t.revisionImpact}</p>
      {feedback}
      <div className="modal-actions">
        <Button variant="quiet" disabled={busy || uncertain} onClick={() => setConfirmation(null)}>{t.keep}</Button>
        <Button variant="dangerSolid" icon={uncertain ? 'refresh' : 'trash'} disabled={busy} loading={busy} onClick={() => void run(confirmation)}>{busy ? t.withdrawing : uncertain ? t.retry : t.confirm}</Button>
      </div>
    </Modal>}
  </div>;
}
