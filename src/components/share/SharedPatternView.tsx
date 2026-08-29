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
    <div className="shared-pattern-layout">
      <section className="shared-pattern-canvas"><PatternPreview pattern={pattern} /></section>
      <aside className="shared-color-list">
        <header><span>{t.colorsTitle}</span><strong>{t.colorCount(stats.length)}</strong></header>
        <ColorBand colors={stats.map((item) => item.hex)} max={20} label={t.bandAria(stats.length)} />
        <ul>
          {stats.map((item) => (
            <li key={item.hex}>
              <span
                aria-hidden="true"
                style={{ backgroundColor: item.hex }}
              />
              <code>{item.code}</code>
              <strong>
                {item.count} {zhCN.export.countUnit}
              </strong>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
