'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { COMMUNITY_LICENSE_VERSION, communitySnapshotFromProject, deriveCommunityPreview } from '@/lib/community/snapshot';
import { createDoupuApi } from '@/lib/sync/api';
import { ApiError, type CloudDesignFull, type CloudDesignMeta } from '@/lib/sync/clientAdapter';
import CommunityPreviewCanvas from './CommunityPreviewCanvas';
import { track } from '@/lib/analytics/client';
import { zhCN } from '@/messages/zh-CN';

interface Tag { id: string; name: string; }
interface Attempt {
  key: string;
  submitKey: string;
  payload: { designId: string; expectedDesignRevision: number; title: string; licenseVersion: string; tagIds: string[] };
  draft?: { revisionId: string; version: number };
}

async function post(url: string, key: string, payload: unknown) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? '暂时无法提交，请重试。');
  if (typeof body?.revisionId !== 'string' || !Number.isInteger(body?.version) || body.version < 1) {
    throw new Error('未能确认服务器结果，请重试原投稿。');
  }
  return { revisionId: body.revisionId as string, version: body.version as number };
}

export default function CommunitySubmitForm({ initialDesignId = '', displayName, workId }: {
  initialDesignId?: string; displayName: string; workId?: string;
}) {
  const t = zhCN.communityAdmin.submission;
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

  async function selectSource(id: string) {
    const seq = ++generation.current;
    setDesignId(id); setSource(null); setAccepted(false); setTitle(''); setError(null);
    if (!id) { setLoading(false); return; }
    setLoading(true);
    try {
      const value = await createDoupuApi().getDesign(id);
      if (!mounted.current || generation.current !== seq) return;
      if (!value || value.deleted || !communitySnapshotFromProject(value.project)) throw new Error('此设计暂时无法投稿，请返回设计检查图纸并同步。');
      setSource(value); setTitle(value.name.slice(0, 80));
    } catch (caught) {
      if (mounted.current && generation.current === seq) setError(caught instanceof Error ? caught.message : '预览加载失败，请重试。');
    } finally {
      if (mounted.current && generation.current === seq) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void Promise.all([
      createDoupuApi().listDesigns(),
      fetch('/api/community/tags').then(async (response) => {
        if (!response.ok) throw new Error('投稿选项加载失败，请重新载入。');
        return response.json() as Promise<{ items: Tag[] }>;
      }),
    ]).then(async ([items, body]) => {
      if (!active) return;
      const available = items.filter((item) => !item.deleted);
      setDesigns(available); setTags(body.items);
      if (initialDesignId && !available.some((item) => item.id === initialDesignId)) {
        setError('这张设计未同步、已删除或不属于当前账号。请返回设计同步，或重新选择。');
        setLoading(false);
      } else if (initialDesignId) {
        await selectSource(initialDesignId);
      } else setLoading(false);
    }).catch(() => {
      if (active) { setError('云端设计或投稿选项加载失败，请重新载入。'); setLoading(false); }
    });
    return () => { active = false; mounted.current = false; generation.current += 1; };
  }, [initialDesignId]);

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
      await post(`/api/community/revisions/${current.draft.revisionId}/submit`, current.submitKey, { expectedVersion: current.draft.version });
      if (!mounted.current) return;
      track({ name: 'community_submission_submitted', properties: {} });
      router.push('/community/mine');
    } catch (caught) {
      if (!mounted.current) return;
      const message = caught instanceof Error ? caught.message : t.failed;
      setError(current.draft ? `草稿已保留。${message} 可重试提交审核，或在“我的投稿”继续处理。` : message);
      // A definite validation rejection cannot have committed a draft; uncertain responses keep the original request.
      if (!current.draft && caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 429) {
        attempt.current = null; setLocked(false); setAccepted(false);
        if (caught.code === 'STATE_CONFLICT') setSource(null);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const preview = source ? deriveCommunityPreview(source.project.pattern) : null;
  return (
    <form className="community-submit-form" onSubmit={(event) => void submit(event)}>
      <p>{workId ? '这次修改会重新审核，通过前原公开作品保持不变。' : '先确认公开预览。原图、私人设计和分享链接不会随投稿公开。'}</p>
      <label>选择云端设计<select className="input-field" value={designId} disabled={loading || locked} onChange={(event) => void selectSource(event.target.value)}>
        <option value="">请选择已同步的设计</option>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}
      </select></label>
      {loading && <p role="status">正在读取云端设计…</p>}
      {!loading && !designs.length && !error && <p>还没有可投稿的云端设计。请先在工作台保存并同步。</p>}
      {preview && <section className="submission-preview" aria-label="公开预览"><CommunityPreviewCanvas preview={preview} label={`公开预览：${title || source!.name}`} /><div><strong>{title || source!.name}</strong><p>公开作者：{displayName}</p><p>{preview.originalWidth} × {preview.originalHeight} 格 · 以本次云端预览为准</p></div></section>}
      <label>{t.title}<input className="input-field" value={title} maxLength={80} disabled={!source || locked} onChange={(event) => setTitle(event.target.value)} required /></label>
      {tags.length > 0 && <fieldset disabled={locked}><legend>{t.tags}</legend><div className="community-tag-picker">{tags.map((tag) => (
        <label key={tag.id}><input type="checkbox" checked={selected.includes(tag.id)} disabled={!selected.includes(tag.id) && selected.length >= 10} onChange={(event) => setSelected((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id))} />{tag.name}</label>
      ))}</div></fieldset>}
      <label className="community-license-check"><input type="checkbox" checked={accepted} disabled={!source || locked} onChange={(event) => setAccepted(event.target.checked)} />
        <span>{t.license}<Link href="/community/copyright" className="link-soft">{t.copyright}</Link></span>
      </label>
      {error && <div role="alert" className="notice notice-danger"><p>{error}</p>{!locked && <button type="button" className="btn-outline btn-sm" onClick={() => designId ? void selectSource(designId) : window.location.reload()}>重新载入预览</button>}</div>}
      <div className="community-form-actions"><Link href={hasDraft || locked ? '/community/mine' : '/designs'} className="btn-outline">{hasDraft || locked ? '查看我的投稿' : t.back}</Link><button className="btn-primary" disabled={busy || loading || (!locked && (!accepted || !source || !title.trim()))}>{busy ? t.submitting : hasDraft ? '重试提交审核' : locked ? '重试原投稿' : t.submit}</button></div>
    </form>
  );
}
