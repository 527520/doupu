'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { openIndexedDb, parseStoredProject, type StorageAdapter } from '@/lib/storage';
import { isProgressCompatible, isStitchableCell, summarizeProgress } from '@/lib/progress/stitchProgress';
import ColorBand from '@/components/palettes/ColorBand';
import { zhCN } from '@/messages/zh-CN';

interface RecentDesign {
  id: string; name: string; thumbnail: string | null; width: number; height: number;
  colors: string[]; percent: number | null; activityAt: number;
}

export default function RecentDesigns({ storage }: { storage?: Pick<StorageAdapter, 'getAll' | 'getStitchProgress'> }) {
  const t = zhCN.home;
  const [items, setItems] = useState<RecentDesign[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const adapter = storage ?? await openIndexedDb();
      const records = await adapter.getAll();
      const recent = await Promise.all(records.map(async (record): Promise<RecentDesign | null> => {
        const project = parseStoredProject(record.projectJson);
        if (!project) return null;
        const progress = await adapter.getStitchProgress(record.id).catch(() => null);
        const summary = isProgressCompatible(progress, project.pattern) ? summarizeProgress(progress, project.pattern.cells) : null;
        return {
          id: record.id, name: record.name, thumbnail: record.thumbnail, width: project.pattern.width, height: project.pattern.height,
          colors: [...new Set(project.pattern.cells.filter(isStitchableCell).map((cell) => cell.hex!))].slice(0, 8),
          percent: summary && summary.doneCount > 0 ? summary.percent : null,
          activityAt: Math.max(Date.parse(record.updatedAt) || 0, summary ? Date.parse(progress!.updatedAt) || 0 : 0),
        };
      }));
      if (!cancelled) {
        const readable = recent.filter((item): item is RecentDesign => item !== null);
        setItems(readable.sort((a, b) => b.activityAt - a.activityAt || a.id.localeCompare(b.id)).slice(0, 3));
        setFailed(records.length > 0 && readable.length === 0);
      }
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attempt, storage]);

  return <section className="home-recent" aria-labelledby="recent-designs-title">
    <header><h2 id="recent-designs-title">{t.recentTitle}</h2><Link href="/designs" className="link-soft">{t.allDesigns}</Link></header>
    {failed ? <p>{t.recentUnavailable} <button type="button" className="btn-outline" onClick={() => setAttempt((value) => value + 1)}>{zhCN.common.retry}</button></p>
      : items === null ? <p aria-live="polite">{t.recentLoading}</p>
        : items.length === 0 ? <p>{t.recentEmpty}</p>
          : <ul>{items.map((item) => <li key={item.id}>
            <Link href={`/app?id=${encodeURIComponent(item.id)}&mode=${item.percent === null ? 'edit' : 'stitch'}`} aria-label={`${item.percent === null ? t.resumeEdit : t.resumeStitch}：${item.name}`}>
              <div className="recent-design-preview">{item.thumbnail
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={item.thumbnail} alt="" /> : <span>{item.width} × {item.height}</span>}</div>
              <div><h3>{item.name}</h3><p>{item.percent === null ? t.resumeEdit : t.stitchPercent(item.percent)}</p>
                <ColorBand className="recent-color-band" colors={item.colors} max={8} label={zhCN.designs.colorBandAria(item.name, item.colors.length)} />
              </div><span className="recent-design-action">{item.percent === null ? t.resumeEdit : t.resumeStitch} →</span>
            </Link>
          </li>)}</ul>}
  </section>;
}
