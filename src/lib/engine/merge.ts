/**
 * 按目标颜色数合并（spec §F4.5）：
 * 颜色按频率降序，低频色与「首个更高频且 Oklab 距离 < θ」的颜色合并；
 * 二分查找满足 distinct ≤ K 的最小 θ∈[0,60]；K ≥ 初始 distinct 时不合并。
 * 完全确定性（稳定排序 + 整数二分）。
 */
import { hexToRgb, oklabDistance, type Rgb } from './color';
import type { PaletteColor, PatternCell } from '@/lib/types';

export interface MergeResult {
  cells: PatternCell[];
  thresholdUsed: number;
}

export function mergeByTargetCount(
  cells: PatternCell[],
  palette: PaletteColor[],
  K: number,
): MergeResult {
  // 统计各 hex 频率（仅非透明格）
  const counts = new Map<string, number>();
  for (const cell of cells) {
    if (cell.transparent || cell.hex === null) continue;
    counts.set(cell.hex, (counts.get(cell.hex) ?? 0) + 1);
  }
  const distinct = counts.size;
  const target = Math.max(1, Math.floor(K));
  if (distinct <= target) return { cells, thresholdUsed: 0 };

  // 频率降序；同频按 hex 字典序（确定性）
  const hexes = [...counts.keys()].sort((a, b) => {
    const d = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
  });
  const rgbByHex = new Map<string, Rgb>();
  for (const hex of hexes) {
    const rgb = hexToRgb(hex);
    if (!rgb) throw new Error(`invalid cell hex: ${hex}`);
    rgbByHex.set(hex, rgb);
  }
  const codeByHex = new Map<string, string | null>();
  for (const p of palette) codeByHex.set(p.hex, p.code);

  const applyThreshold = (theta: number): { cells: PatternCell[]; distinct: number } => {
    const replaced = new Map<string, string>(); // 低频 hex → 替换为的高频 hex
    for (let i = 0; i < hexes.length; i++) {
      const hi = hexes[i];
      if (replaced.has(hi)) continue;
      for (let j = i + 1; j < hexes.length; j++) {
        const hj = hexes[j];
        if (replaced.has(hj)) continue;
        if (oklabDistance(rgbByHex.get(hi)!, rgbByHex.get(hj)!) < theta) {
          replaced.set(hj, hi);
        }
      }
    }
    if (replaced.size === 0) return { cells, distinct };
    const survivors = new Set<string>();
    for (const hex of hexes) survivors.add(replaced.get(hex) ?? hex);
    const next = cells.map((cell) => {
      if (cell.transparent || cell.hex === null) return cell;
      const replacement = replaced.get(cell.hex);
      if (!replacement) return cell;
      return { hex: replacement, code: codeByHex.get(replacement) ?? null, transparent: false, external: false };
    });
    return { cells: next, distinct: survivors.size };
  };

  // 可行性检查：θ=60 仍不达标 → 取可达最小值（spec 边界）
  const at60 = applyThreshold(60);
  if (at60.distinct > target) return { cells: at60.cells, thresholdUsed: 60 };

  let lo = 0;
  let hi = 60;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (applyThreshold(mid).distinct <= target) hi = mid;
    else lo = mid + 1;
  }
  return { cells: applyThreshold(lo).cells, thresholdUsed: lo };
}
