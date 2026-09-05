'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { communityPreviewSchema } from '@/lib/community/snapshot';
import CommunityPreviewCanvas from './CommunityPreviewCanvas';
import { zhCN } from '@/messages/zh-CN';

const shelfResponse = z.object({ items: z.array(z.object({
  id: z.string().min(1), title: z.string(), featured: z.boolean(),
  width: z.number().int().min(1).max(200), height: z.number().int().min(1).max(200),
  author: z.object({ displayName: z.string() }), preview: communityPreviewSchema,
})).max(24) });
type ShelfWork = z.infer<typeof shelfResponse>['items'][number];

export default function HomeCommunityShelf() {
  const t = zhCN.communityAdmin.home;
  const [state, setState] = useState<{ featured: ShelfWork[]; latest: ShelfWork[] } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    const read = async (sort: 'featured' | 'latest'): Promise<ShelfWork[]> => {
      const response = await fetch(`/api/community/works?sort=${sort}`, { signal: controller.signal });
      if (!response.ok) throw new Error('COMMUNITY_READ_FAILED');
      return shelfResponse.parse(await response.json()).items;
    };
    void Promise.all([read('featured'), read('latest')])
      .then(([featured, latest]) => {
        if (cancelled) return;
        setState({ featured: featured.filter((work) => work.featured).slice(0, 3), latest: latest.slice(0, 3) });
        setError(false);
      }).catch(() => { if (!cancelled) setError(true); }).finally(() => window.clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [attempt]);
  const cards = (items: ShelfWork[]) => <ul>{items.map((work) => <li key={work.id}><Link href={`/community/${work.id}`}><CommunityPreviewCanvas preview={work.preview} label={t.preview(work.title)} /><strong>{work.title}</strong><small>{work.author.displayName} · {work.width}×{work.height}</small><span className="community-color-band">{work.preview.colorBand.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span></Link></li>)}</ul>;
  return (
    <section className="home-community">
      <header><div><span className="studio-eyebrow">{state?.featured.length ? t.featured : t.latest}</span><h2>{state?.featured.length ? t.featuredProofs : t.latestProofs}</h2></div><Link href="/community" className="btn-outline btn-sm">{t.open}</Link></header>
      {error ? <div><p role="alert">{t.loadFailed}</p><button type="button" className="btn-outline" onClick={() => { setError(false); setState(null); setAttempt((value) => value + 1); }}>{zhCN.common.retry}</button></div>
        : !state ? <p role="status">{t.loading}</p>
          : <>{state.featured.length > 0 && <>{cards(state.featured)}<header className="home-community-latest"><div><span className="studio-eyebrow">{t.latest}</span><h2>{t.latestProofs}</h2></div></header></>}{state.latest.length > 0 ? cards(state.latest) : <p>{t.empty}</p>}</>}
    </section>
  );
}
