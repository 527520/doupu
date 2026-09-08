'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { openIndexedDb, parseStoredProject, renderThumbnail, type StorageAdapter } from '@/lib/storage';
import { getBoardProfile } from '@/lib/boardProfiles';
import type { Pattern } from '@/lib/types';
import { isProgressCompatible, isStitchableCell, summarizeProgress } from '@/lib/progress/stitchProgress';
import ColorBand from '@/components/palettes/ColorBand';
import { zhCN } from '@/messages/zh-CN';
import type { CSSProperties } from 'react';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';

interface RecentDesign {
  id: string; name: string; thumbnail: string | null; width: number; height: number;
  colors: string[]; percent: number | null; activityAt: number;
}
type RecentCandidate = RecentDesign & { pattern: Pattern; boardSize: number };

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
      const recent = await Promise.all(records.map(async (record): Promise<RecentCandidate | null> => {
        const project = parseStoredProject(record.projectJson);
        if (!project) return null;
        const progress = await adapter.getStitchProgress(record.id);
        const summary = isProgressCompatible(progress, project.pattern) ? summarizeProgress(progress, project.pattern.cells) : null;
        return {
          id: record.id, name: record.name, thumbnail: record.thumbnail, width: project.pattern.width, height: project.pattern.height,
          pattern: project.pattern, boardSize: getBoardProfile(project.boardProfile).boardCols,
          colors: [...new Set(project.pattern.cells.filter(isStitchableCell).map((cell) => cell.hex!))].slice(0, 8),
          percent: summary && summary.doneCount > 0 ? summary.percent : null,
          activityAt: Math.max(Date.parse(record.updatedAt) || 0, summary ? Date.parse(progress!.updatedAt) || 0 : 0),
        };
      }));
      if (!cancelled) {
        const readable = recent.filter((item): item is RecentCandidate => item !== null);
        // 仅为最终展示的三张图纸补齐预览，不写回存储或渲染整个设计库。
        setItems(readable.sort((a, b) => b.activityAt - a.activityAt || a.id.localeCompare(b.id)).slice(0, 3)
          .map(({pattern, boardSize, ...item})=>({...item,thumbnail:item.thumbnail ?? renderThumbnail(pattern,192,boardSize)})));
        setFailed(records.length > 0 && readable.length === 0);
      }
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attempt, storage]);

  return <section className="home-recent" aria-labelledby="recent-designs-title">
    <header><h2 id="recent-designs-title">{t.recentTitle}</h2><Link href="/designs" className="link-action">{t.allDesigns}</Link></header>
    {failed ? <div className="admin-command-notice"><Notice kind="danger" as="div"><span>{t.recentUnavailable}</span><Button variant="secondary" size="sm" icon="refresh" onClick={() => setAttempt((value) => value + 1)}>{zhCN.common.retry}</Button></Notice></div>
      : items === null ? <p aria-live="polite" aria-busy="true">{t.recentLoading}</p>
        : items.length === 0 ? <p>{t.recentEmpty}</p>
          : <ul className="stagger">{items.map((item, index) => <li key={item.id} style={{ '--i': index } as CSSProperties}>
            <Link href={`/app?id=${encodeURIComponent(item.id)}&mode=${item.percent === null ? 'edit' : 'stitch'}`} aria-label={t.resumeAria(item.percent === null ? t.resumeEdit : t.resumeStitch, item.name)}>
              <div className="recent-design-preview">{item.thumbnail
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={item.thumbnail} alt="" /> : <span>{item.width} × {item.height}</span>}</div>
              <div><h3>{item.name}</h3><p>{item.percent === null ? `${item.width} × ${item.height}` : t.stitchPercent(item.percent)}</p>
                <ColorBand className="recent-color-band" colors={item.colors} max={8} label={zhCN.designs.colorBandAria(item.name, item.colors.length)} />
              </div><span className="recent-design-action">{item.percent === null ? t.resumeEdit : t.resumeStitch} →</span>
            </Link>
          </li>)}</ul>}
  </section>;
}
