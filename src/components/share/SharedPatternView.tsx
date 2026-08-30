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
import type { BoardProfileId, Pattern, PatternStatsItem, ProjectPalette } from '@/lib/types';
import { getBoardProfile } from '@/lib/boardProfiles';
import { getBuiltinPalette } from '@/lib/palettes';

interface Props {
  pattern: Pattern;
  stats: readonly PatternStatsItem[];
  boardProfile: BoardProfileId;
  palette: ProjectPalette;
}

export default function SharedPatternView({ pattern, stats, boardProfile, palette }: Props) {
  const t = zhCN.share;
  const board = getBoardProfile(boardProfile);
  const paletteLabel = palette.kind === 'builtin'
    ? getBuiltinPalette(palette.brand).label
    : t.customPalette(palette.colors.length);
  return (
    <>
      <dl className="shared-pattern-meta" role="group" aria-label={t.materialDetails}>
        <div><dt>{t.boardProfile}</dt><dd>{board.displayName}</dd></div>
        <div><dt>{t.palette}</dt><dd>{paletteLabel}</dd></div>
      </dl>
      <div className="shared-pattern-layout">
        <section className="shared-pattern-canvas"><PatternPreview pattern={pattern} boardSize={board.boardCols} /></section>
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
    </>
  );
}
