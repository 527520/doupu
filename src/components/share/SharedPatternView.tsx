'use client';

/**
 * 只读分享页的图纸展示（批次 K）。
 *
 * 复用工作台的预览组件（缩放/网格/板缝/色号标注这些「照着拼」真正需要的能力都在里面），
 * 但不提供任何编辑入口。用色清单直接列全，因为看分享链接的人下一步就是照着买豆子。
 */
import PatternPreview from '@/components/preview/PatternPreview';
import ColorBand from '@/components/palettes/ColorBand';
import { zhCN } from '@/messages/zh-CN';
import type { Pattern, PatternStatsItem } from '@/lib/types';

interface Props {
  pattern: Pattern;
  stats: readonly PatternStatsItem[];
}

export default function SharedPatternView({ pattern, stats }: Props) {
  const t = zhCN.share;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_240px]">
      <PatternPreview pattern={pattern} />
      <aside className="card-surface flex flex-col gap-2 p-3 text-sm">
        <p className="font-medium text-ink">{t.colorsTitle}</p>
        <ColorBand colors={stats.map((item) => item.hex)} max={20} label={t.bandAria(stats.length)} />
        <ul className="flex max-h-72 flex-col gap-1 overflow-auto pr-1">
          {stats.map((item) => (
            <li key={item.hex} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 shrink-0 rounded-sm border border-lilac/40"
                style={{ backgroundColor: item.hex }}
              />
              <span className="font-mono text-ink">{item.code}</span>
              <span className="ml-auto tabular-nums text-ink-soft">
                {item.count} {zhCN.export.countUnit}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
