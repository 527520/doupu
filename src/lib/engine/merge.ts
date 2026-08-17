/**
 * 按目标颜色数合并（spec §F4.5）：
 * 颜色按频率降序，低频色与「首个更高频且 Oklab 距离 < θ」的颜色合并；
 * 穷举满足 distinct ≤ K 的最小整数 θ∈[0,60]；K ≥ 初始 distinct 时不合并。
 * 完全确定性（稳定排序 + 有限整数穷举）。
 */
import { hexToRgb, oklabSquaredDistance, rgbToOklab } from './color';
import type { PaletteColor, PatternCell } from '@/lib/types';
import { assertGenerationActive, type CancellationProbe } from './types';

export interface MergeResult {
  cells: PatternCell[];
  thresholdUsed: number;
}

export function mergeByTargetCount(
  cells: PatternCell[],
  palette: PaletteColor[],
  K: number,
  shouldCancel?: CancellationProbe,
): MergeResult {
  // 统计各 hex 频率（仅需要制作的非透明、非背景格）
  const counts = new Map<string, number>();
  for (const cell of cells) {
    if (cell.transparent || cell.external || cell.hex === null) continue;
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
  const labs = hexes.map((hex) => {
    const rgb = hexToRgb(hex);
    if (!rgb) throw new Error(`invalid cell hex: ${hex}`);
    return rgbToOklab(rgb);
  });
  // applyThreshold 有意保留贪心代表选择，其 distinct 随 θ 可能非单调；
  // 一次预计算距离后穷举 61 个阈值，既正确又避免重复 Oklab 转换。
  const distances = new Float64Array(hexes.length * hexes.length);
  for (let i = 0; i < hexes.length; i++) {
    assertGenerationActive(shouldCancel);
    for (let j = i + 1; j < hexes.length; j++) {
      const distance = Math.sqrt(oklabSquaredDistance(labs[i], labs[j])) * 100;
      distances[i * hexes.length + j] = distance;
      distances[j * hexes.length + i] = distance;
    }
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
        if (distances[i * hexes.length + j] < theta) {
          replaced.set(hj, hi);
        }
      }
    }
    if (replaced.size === 0) return { cells, distinct };
    const survivors = new Set<string>();
    for (const hex of hexes) survivors.add(replaced.get(hex) ?? hex);
    const next = cells.map((cell) => {
      if (cell.transparent || cell.external || cell.hex === null) return cell;
      const replacement = replaced.get(cell.hex);
      if (!replacement) return cell;
      return { hex: replacement, code: codeByHex.get(replacement) ?? null, transparent: false, external: false };
    });
    return { cells: next, distinct: survivors.size };
  };

  let at60: { cells: PatternCell[]; distinct: number } | null = null;
  for (let theta = 0; theta <= 60; theta++) {
    assertGenerationActive(shouldCancel);
    const candidate = applyThreshold(theta);
    if (theta === 60) at60 = candidate;
    if (candidate.distinct <= target) {
      return { cells: candidate.cells, thresholdUsed: theta };
    }
  }
  // θ=60 仍不达标 → 取可达最小值（spec 边界）
  return { cells: at60!.cells, thresholdUsed: 60 };
}
