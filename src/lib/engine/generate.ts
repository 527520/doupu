/**
 * 生成管线编排（spec §F4，确定性顺序）：
 * 预处理 →（可选）抖动 → 格采样 → 匹配 → 频率合并 →（可选）背景去除 → 统计。
 * 输入 params 假定已通过 generationParamsSchema 校验；palette 为调用方过滤后的可用色。
 */
import { applyBrightnessContrast } from './brightness';
import { downscaleBox } from './downscale';
import { buildLut, lutIndex } from './lut';
import { floydSteinberg } from './dither';
import { sampleCells } from './sample';
import { mergeByTargetCount } from './merge';
import { removeBackground } from './background';
import { hexToRgb } from './color';
import { type EngineOutput, type ImageDataLike } from './types';
import type { GenerationParams, PaletteColor, PatternCell, PatternStatsItem } from '@/lib/types';

/** 每格最多取 8×8 源像素（性能预算：200×200 图纸 ≤2s）。 */
const MAX_SOURCE_PIXELS_PER_CELL = 8;

/** 进度上报（优化票 07）：0→100，按管线阶段单调递增。 */
export type ProgressReporter = (percent: number) => void;

export function generatePattern(
  imageData: ImageDataLike,
  params: GenerationParams,
  palette: PaletteColor[],
  onProgress?: ProgressReporter,
): EngineOutput {
  if (palette.length === 0) throw new Error('palette is empty');
  const W = params.targetWidth;
  const M = Math.min(200, Math.max(1, Math.round((W * imageData.height) / imageData.width)));

  onProgress?.(5);
  // 1. 降采样到与图纸规模匹配的工作分辨率（不放大）
  const working = downscaleBox(imageData, Math.max(W, M) * MAX_SOURCE_PIXELS_PER_CELL);
  onProgress?.(15);
  // 2. 亮度/对比度
  const adjusted = applyBrightnessContrast(working, params.brightness, params.contrast);
  onProgress?.(28);
  // 3. 抖动（可选）
  const lut = buildLut(palette);
  const dithered = params.dithering ? floydSteinberg(adjusted, lut) : adjusted;
  onProgress?.(40);
  // 4. 格采样
  const sampled = sampleCells(dithered, W, M, params.mode);
  onProgress?.(55);
  // 5. 匹配（LUT 查最近色）
  for (const cell of sampled) {
    if (cell.transparent || cell.hex === null) continue;
    const rgb = hexToRgb(cell.hex);
    if (!rgb) throw new Error(`invalid sampled hex: ${cell.hex}`);
    const p = lutIndex(lut, rgb.r, rgb.g, rgb.b);
    cell.hex = palette[p].hex;
    cell.code = palette[p].code;
  }
  onProgress?.(70);
  // 6. 合并
  const merged = mergeByTargetCount(sampled, palette, params.targetColorCount);
  onProgress?.(82);
  // 7. 背景去除（可选）
  const cells = params.backgroundRemoval
    ? removeBackground(merged.cells, W, M, params.bgTolerance)
    : merged.cells;
  onProgress?.(93);
  // 8. 统计
  const stats = computeStats(cells);
  onProgress?.(100);

  return {
    pattern: { width: W, height: M, cells },
    stats,
    totalBeadCount: stats.reduce((sum, item) => sum + item.count, 0),
    mergeThresholdUsed: merged.thresholdUsed,
  };
}

/** 用量统计：非透明、非外部格按 hex 分组，数量降序（同数量按 hex 字典序，确定性）。 */
export function computeStats(cells: PatternCell[]): PatternStatsItem[] {
  const byHex = new Map<string, PatternStatsItem>();
  for (const cell of cells) {
    if (cell.transparent || cell.external || cell.hex === null) continue;
    const existing = byHex.get(cell.hex);
    if (existing) {
      existing.count++;
    } else {
      byHex.set(cell.hex, { code: cell.code ?? '?', hex: cell.hex, count: 1 });
    }
  }
  return [...byHex.values()].sort((a, b) => {
    const d = b.count - a.count;
    return d !== 0 ? d : a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0;
  });
}
