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
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/community/works?sort=featured').then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (cancelled || !Array.isArray(body?.items)) return;
        const featured = (body.items as ShelfWork[]).filter((work) => work.featured).slice(0, 3);
        setState({ items: featured.length > 0 ? featured : body.items.slice(0, 3), featured: featured.length > 0 });
      }, () => undefined);
    return () => { cancelled = true; };
  }, []);
  if (!state || state.items.length === 0) return null;
  return (
    <section className="home-community">
      <header><div><span className="studio-eyebrow">{state.featured ? t.featured : t.latest}</span><h2>{state.featured ? t.featuredProofs : t.latestProofs}</h2></div><Link href="/community" className="btn-outline btn-sm">打开豆社</Link></header>
      <ul>{state.items.map((work) => <li key={work.id}><Link href={`/community/${work.id}`}><CommunityPreviewCanvas preview={work.preview} label={`${work.title} 预览`} /><strong>{work.title}</strong><small>{work.author.displayName} · {work.width}×{work.height}</small><span className="community-color-band">{work.preview.colorBand.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span></Link></li>)}</ul>
    </section>
  );
}
