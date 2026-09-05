'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { COMMUNITY_LICENSE_VERSION, communitySnapshotFromProject, deriveCommunityPreview } from '@/lib/community/snapshot';
import { createDoupuApi } from '@/lib/sync/api';
import { ApiError, type CloudDesignFull, type CloudDesignMeta } from '@/lib/sync/clientAdapter';
import CommunityPreviewCanvas from './CommunityPreviewCanvas';
import { isDefiniteCommunityRejection, postCommunityCommand } from './communityCommand';
import { track } from '@/lib/analytics/client';
import { zhCN } from '@/messages/zh-CN';
import { z } from 'zod';

interface Tag { id: string; name: string; }
const t = zhCN.communityAdmin.submission;
const uuid = z.uuid();
interface Attempt {
  key: string;
  submitKey: string;
  payload: { designId: string; expectedDesignRevision: number; title: string; licenseVersion: string; tagIds: string[] };
  draft?: { revisionId: string; version: number };
}

async function post(url: string, key: string, payload: object, submitted?: { revisionId: string; version: number }) {
  const body = await postCommunityCommand(url, key, payload);
  if (typeof body.revisionId !== 'string' || !uuid.safeParse(body.revisionId).success || typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 1
    || (url === '/api/community/works' && !uuid.safeParse(body.workId).success)
    || (submitted ? body.revisionId !== submitted.revisionId || body.version !== submitted.version + 1 || body.status !== 'pending_review' : body.status !== 'draft' || body.version !== 1)) {
    throw new Error(zhCN.communityAdmin.submission.unknownResult);
  }
  return { revisionId: body.revisionId, version: body.version };
}

export default function CommunitySubmitForm({ initialDesignId = '', displayName, workId }: {
  initialDesignId?: string; displayName: string; workId?: string;
}) {
  const router = useRouter();
  const [designs, setDesigns] = useState<CloudDesignMeta[]>([]);
  const [designId, setDesignId] = useState('');
  const [source, setSource] = useState<CloudDesignFull | null>(null);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  const selectSource = useCallback(async (id: string) => {
    const seq = ++generation.current;
    setDesignId(id); setSource(null); setAccepted(false); setTitle(''); setError(null);
    if (!id) { setLoading(false); return; }
    setLoading(true);
    try {
      const value = await createDoupuApi().getDesign(id);
      if (!mounted.current || generation.current !== seq) return;
      if (!value || value.deleted || !communitySnapshotFromProject(value.project)) throw new ApiError(400, 'VALIDATION', t.sourceInvalid);
      setSource(value); setTitle(value.name.slice(0, 80));
    } catch (caught) {
      if (mounted.current && generation.current === seq) setError(caught instanceof ApiError ? caught.message : t.previewFailed);
    } finally {
      if (mounted.current && generation.current === seq) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void Promise.all([
      createDoupuApi().listDesigns(),
      fetch('/api/community/tags').then(async (response) => {
        if (!response.ok) throw new Error(t.optionsFailed);
        return response.json() as Promise<{ items: Tag[] }>;
      }),
    ]).then(async ([items, body]) => {
      if (!active) return;
      const available = items.filter((item) => !item.deleted);
      setDesigns(available); setTags(body.items);
      if (initialDesignId && !available.some((item) => item.id === initialDesignId)) {
        setError(t.sourceUnavailable);
        setLoading(false);
      } else if (initialDesignId) {
        await selectSource(initialDesignId);
      } else setLoading(false);
    }).catch(() => {
      if (active) { setError(t.loadFailed); setLoading(false); }
    });
    return () => { active = false; mounted.current = false; generation.current += 1; };
  }, [initialDesignId, selectSource]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || (!attempt.current && (!accepted || !source || !title.trim()))) return;
    pending.current = true; setBusy(true); setError(null); setLocked(true);
    const current = attempt.current ?? {
      key: crypto.randomUUID(), submitKey: crypto.randomUUID(),
      payload: { designId, expectedDesignRevision: source!.revision, title: title.trim(), licenseVersion: COMMUNITY_LICENSE_VERSION, tagIds: selected },
    };
    attempt.current = current;
    try {
      if (!current.draft) {
        current.draft = await post(workId ? `/api/community/works/${workId}/revisions` : '/api/community/works', current.key, current.payload);
        if (!mounted.current) return;
        setHasDraft(true);
        track({ name: 'community_submission_created', properties: {} });
      }
      await post(`/api/community/revisions/${current.draft.revisionId}/submit`, current.submitKey, { expectedVersion: current.draft.version }, current.draft);
      if (!mounted.current) return;
      track({ name: 'community_submission_submitted', properties: {} });
      router.push('/community/mine');
    } catch (caught) {
      if (!mounted.current) return;
      const message = caught instanceof Error ? caught.message : t.failed;
      setError(current.draft ? t.draftKept(message) : message);
      // A definite validation rejection cannot have committed a draft; uncertain responses keep the original request.
      if (!current.draft && isDefiniteCommunityRejection(caught)) {
        attempt.current = null; setLocked(false); setAccepted(false);
        if (caught instanceof ApiError && caught.code === 'STATE_CONFLICT') setSource(null);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const preview = source ? deriveCommunityPreview(source.project.pattern) : null;
  return (
    <form className="community-submit-form" onSubmit={(event) => void submit(event)}>
      <p>{workId ? t.editHelp : t.previewHelp}</p>
      <ResponsiveSelect label={t.chooseSource} value={designId} disabled={loading || locked} onValueChange={(value)=>void selectSource(value)} options={[{value:'',label:t.choosePlaceholder},...designs.map(design=>({value:design.id,label:design.name}))]} />
      {loading && <p role="status">{t.loadingSources}</p>}
      {!loading && !designs.length && !error && <p>{t.noSources}</p>}
      {preview && <section className="submission-preview" aria-label={t.preview}><CommunityPreviewCanvas preview={preview} label={t.previewAria(title || source!.name)} /><div><strong>{title || source!.name}</strong><p>{t.author}{displayName}</p><p>{t.previewSize(preview.originalWidth, preview.originalHeight)}</p></div></section>}
      <label>{t.title}<input className="input-field" value={title} maxLength={80} disabled={!source || locked} onChange={(event) => setTitle(event.target.value)} required /></label>
      {tags.length > 0 && <fieldset disabled={locked}><legend>{t.tags}</legend><div className="community-tag-picker">{tags.map((tag) => (
        <label key={tag.id}><input type="checkbox" checked={selected.includes(tag.id)} disabled={!selected.includes(tag.id) && selected.length >= 10} onChange={(event) => setSelected((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id))} />{tag.name}</label>
      ))}</div></fieldset>}
      <label className="community-license-check"><input type="checkbox" checked={accepted} disabled={!source || locked} onChange={(event) => setAccepted(event.target.checked)} />
        <span>{t.license}<Link href="/community/copyright" className="link-soft">{t.copyright}</Link></span>
      </label>
      {error && <div role="alert" className="notice notice-danger"><p>{error}</p>{!locked && <button type="button" className="btn-outline btn-sm" onClick={() => designId ? void selectSource(designId) : window.location.reload()}>{t.reloadPreview}</button>}</div>}
      <div className="community-form-actions"><Link href={hasDraft || locked ? '/community/mine' : '/designs'} className="btn-outline">{hasDraft || locked ? t.mine : t.back}</Link><button className="btn-primary" disabled={busy || loading || (!locked && (!accepted || !source || !title.trim()))}>{busy ? t.submitting : hasDraft ? t.retryReview : locked ? t.retryOriginal : t.submit}</button></div>
    </form>
  );
}
