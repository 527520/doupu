'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CommunityPreviewV1 } from '@/lib/community/snapshot';
import CommunityPreviewCanvas from './CommunityPreviewCanvas';
import { zhCN } from '@/messages/zh-CN';

interface ShelfWork {
  id: string;
  title: string;
  featured: boolean;
  width: number;
  height: number;
  author: { displayName: string };
  preview: CommunityPreviewV1;
}

export default function HomeCommunityShelf() {
  const t = zhCN.communityAdmin.home;
  const [state, setState] = useState<{ items: ShelfWork[]; featured: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/community/works?sort=featured').then(async (response) => {
      if (!response.ok) throw new Error('COMMUNITY_READ_FAILED');
      return response.json();
    })
      .then((body) => {
        if (cancelled) return;
        if (!Array.isArray(body?.items)) throw new Error('COMMUNITY_READ_FAILED');
        const featured = (body.items as ShelfWork[]).filter((work) => work.featured).slice(0, 3);
        setState({ items: featured.length > 0 ? featured : body.items.slice(0, 3), featured: featured.length > 0 });
        setError(false);
      }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [attempt]);
  return (
    <section className="home-community">
      <header><div><span className="studio-eyebrow">{state?.featured ? t.featured : t.latest}</span><h2>{state?.featured ? t.featuredProofs : t.latestProofs}</h2></div><Link href="/community" className="btn-outline btn-sm">{t.open}</Link></header>
      {error ? <div><p role="alert">{t.loadFailed}</p><button type="button" className="btn-outline" onClick={() => { setError(false); setState(null); setAttempt((value) => value + 1); }}>{zhCN.common.retry}</button></div>
        : !state ? <p role="status">{t.loading}</p>
          : state.items.length === 0 ? <p>{t.empty}</p>
            : <ul>{state.items.map((work) => <li key={work.id}><Link href={`/community/${work.id}`}><CommunityPreviewCanvas preview={work.preview} label={t.preview(work.title)} /><strong>{work.title}</strong><small>{work.author.displayName} · {work.width}×{work.height}</small><span className="community-color-band">{work.preview.colorBand.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span></Link></li>)}</ul>}
    </section>
  );
}
