/**
 * 图纸级换色板（H-1）。
 *
 * 为什么必须有：换色板此前只能靠「用新色板重新生成」，而重新生成需要本地生成源
 * （`Workbench` 里的 `restored-locked` 状态）——导入的项目文件、换设备打开的云端设计
 * 都没有生成源，于是根本换不了色板；即使能重新生成，也会把手工修补全部冲掉。
 *
 * 这里改成在**图纸上**做重映射：逐格把当前颜色换成新色板里最接近的颜色。
 * 手工修补是格子级的，因此位置与形状完全保留，只是颜色换了一套品牌。
 * 用的是同一套 Oklab 感知距离 + LUT，与生成路径的匹配口径一致（非 AI，D9）。
 */
import { buildLut, lutIndex } from './lut';
import { hexToRgb } from './color';
import { computeStats, totalBeadCount } from './generate';
import type { PaletteColor, Pattern, PatternCell, PatternStatsItem } from '@/lib/types';
import { availablePaletteColors } from '@/lib/palettes/availability';

export interface RemapResult {
  pattern: Pattern;
  stats: PatternStatsItem[];
  totalBeadCount: number;
  /** 实际发生颜色变化的格数（用于告诉用户「换了多少格」） */
  changedCells: number;
}

/**
 * 把图纸重映射到新色板。
 * 透明格与背景（external）格保持原样：它们不需要豆子，也不该被染上颜色。
 */
export function remapPattern(pattern: Pattern, palette: PaletteColor[]): RemapResult {
  // 可用性是引擎不变量（与 generatePattern 一致）：占位色号不能出现在成品里。
  const available = availablePaletteColors(palette);
  if (available.length === 0) throw new Error('palette is empty');

  const lut = buildLut(available);
  /** 同一个 hex 只算一次最近色：图纸最多几百种颜色，但有几万个格子。 */
  const mapped = new Map<string, { hex: string; code: string }>();
  let changedCells = 0;

  const cells: PatternCell[] = pattern.cells.map((cell) => {
    if (cell.transparent || cell.external || cell.hex === null) return cell;
    let next = mapped.get(cell.hex);
    if (!next) {
      const rgb = hexToRgb(cell.hex);
      if (!rgb) throw new Error(`invalid cell hex: ${cell.hex}`);
      const index = lutIndex(lut, rgb.r, rgb.g, rgb.b);
      next = { hex: available[index].hex, code: available[index].code };
      mapped.set(cell.hex, next);
    }
    if (next.hex === cell.hex && next.code === cell.code) return cell;
    changedCells += 1;
    return { hex: next.hex, code: next.code, transparent: false, external: false };
  });

  const stats = computeStats(cells);
  return {
    pattern: { width: pattern.width, height: pattern.height, cells },
    stats,
    totalBeadCount: totalBeadCount(stats),
    changedCells,
  };
}
