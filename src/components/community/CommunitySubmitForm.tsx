'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { COMMUNITY_LICENSE_VERSION } from '@/lib/community/snapshot';
import { track } from '@/lib/analytics/client';
import { zhCN } from '@/messages/zh-CN';

interface Tag { id: string; name: string; }

export default function CommunitySubmitForm() {
  const t = zhCN.communityAdmin.submission;
  const router = useRouter();
  const [designId, setDesignId] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDesignId(new URLSearchParams(window.location.search).get('designId') ?? ''), 0);
    void fetch('/api/community/tags').then((response) => response.ok ? response.json() : null)
      .then((body) => setTags(body?.items ?? []), () => setTags([]));
    return () => window.clearTimeout(timer);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accepted) return;
    setBusy(true);
    setError(null);
    try {
      const created = await fetch('/api/community/works', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ designId, title, licenseVersion: COMMUNITY_LICENSE_VERSION, tagIds: selected }),
      });
      const createdBody = await created.json().catch(() => null);
      if (!created.ok) throw new Error(createdBody?.error?.message ?? t.createFailed);
      track({ name: 'community_submission_created', properties: {} });
      const submitted = await fetch(`/api/community/revisions/${createdBody.revisionId}/submit`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: createdBody.version }),
      });
      const submittedBody = await submitted.json().catch(() => null);
      if (!submitted.ok) throw new Error(submittedBody?.error?.message ?? t.submitFailedDraftKept);
      track({ name: 'community_submission_submitted', properties: {} });
      router.push('/community/mine');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="community-submit-form" onSubmit={(event) => void submit(event)}>
      <label>私人设计 ID<input className="input-field" value={designId} onChange={(event) => setDesignId(event.target.value)} required /></label>
      <label>公开作品标题<input className="input-field" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} required /></label>
      {tags.length > 0 && <fieldset><legend>正式标签（最多 10 个）</legend><div className="community-tag-picker">{tags.map((tag) => (
        <label key={tag.id}><input type="checkbox" checked={selected.includes(tag.id)} disabled={!selected.includes(tag.id) && selected.length >= 10} onChange={(event) => setSelected((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id))} />{tag.name}</label>
      ))}</div></fieldset>}
      <label className="community-license-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        <span>我确认拥有发布权，并授予豆谱展示本作品及允许站内用户创建私人副本的有限许可；不包含站外传播、商业使用或再许可。<Link href="/community/copyright" className="link-soft">查看版权与申诉说明</Link></span>
      </label>
      {error && <p role="alert" className="notice notice-danger">{error}</p>}
      <div className="community-form-actions"><Link href="/designs" className="btn-outline">返回设计</Link><button className="btn-primary" disabled={busy || !accepted || !designId || !title.trim()}>{busy ? t.submitting : t.submit}</button></div>
    </form>
  );
}
