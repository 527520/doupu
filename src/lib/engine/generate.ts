/**
 * 生成管线编排（spec §F4，确定性顺序）：
 * 预处理 →（可选）抖动 → 格采样 → 匹配 →（可选）背景识别 → 频率合并 → 统计。
 * 输入 params 假定已通过 generationParamsSchema 校验；色板可用性由引擎统一过滤。
 */
import { applyBrightnessContrast } from './brightness';
import { downscaleBox } from './downscale';
import { buildLut, lutIndex } from './lut';
import { floydSteinberg } from './dither';
import { sampleCells } from './sample';
import { mergeByTargetCount } from './merge';
import { removeBackground } from './background';
import { hexToRgb } from './color';
import { assertGenerationActive, type CancellationProbe, type EngineOutput, type ImageDataLike } from './types';
import type { GenerationParams, PaletteColor, PatternCell, PatternStatsItem } from '@/lib/types';
import { LIMITS } from '@/lib/appInfo';

/** 每格最多取 4×4 源像素；16 个连续覆盖样本足以保留格内主色/均值，
 * 同时给 200×200 + 291 色的精确 Oklab 抖动留出稳定的 2 秒硬预算。 */
const MAX_SOURCE_PIXELS_PER_CELL = 4;

/** 工作台裁剪可提前收敛到此上限；引擎的最大合法图纸无需更多源像素。 */
export const MAX_GENERATION_SOURCE_DIMENSION = LIMITS.generationSourceDimension;

/** 进度上报（优化票 07）：0→100，按管线阶段单调递增。 */
export type ProgressReporter = (percent: number) => void;

export function generatePattern(
  imageData: ImageDataLike,
  params: GenerationParams,
  palette: PaletteColor[],
  onProgress?: ProgressReporter,
  shouldCancel?: CancellationProbe,
): EngineOutput {
  assertGenerationActive(shouldCancel);
  // 可用性是引擎不变量：品牌色板中 code=null 表示该品牌没有此色号，
  // 不能把过滤责任留给每个调用方，否则会生成无法采购的“?”色号。
  const availablePalette = palette.filter((color) => color.code !== null);
  // 对空输入和“过滤后为空”保持同一领域错误，Worker/UI 不需要分辨内部原因。
  if (availablePalette.length === 0) throw new Error('palette is empty');
  const W = params.targetWidth;
  const M = Math.min(200, Math.max(1, Math.round((W * imageData.height) / imageData.width)));

  onProgress?.(5);
  assertGenerationActive(shouldCancel);
  // 1. 降采样到与图纸规模匹配的工作分辨率（不放大）
  const working = downscaleBox(imageData, Math.max(W, M) * MAX_SOURCE_PIXELS_PER_CELL, shouldCancel);
  onProgress?.(15);
  assertGenerationActive(shouldCancel);
  // 2. 亮度/对比度
  const adjusted = applyBrightnessContrast(working, params.brightness, params.contrast, shouldCancel);
  onProgress?.(28);
  assertGenerationActive(shouldCancel);
  // 3. 抖动（可选）
  const lut = buildLut(availablePalette, shouldCancel);
  const dithered = params.dithering ? floydSteinberg(adjusted, lut, shouldCancel) : adjusted;
  onProgress?.(40);
  assertGenerationActive(shouldCancel);
  // 4. 格采样
  const sampled = sampleCells(dithered, W, M, params.mode, shouldCancel);
  onProgress?.(55);
  assertGenerationActive(shouldCancel);
  // 5. 匹配（LUT 查最近色）
  for (let cellIndex = 0; cellIndex < sampled.length; cellIndex++) {
    if ((cellIndex & 255) === 0) assertGenerationActive(shouldCancel);
    const cell = sampled[cellIndex];
    if (cell.transparent || cell.hex === null) continue;
    const rgb = hexToRgb(cell.hex);
    if (!rgb) throw new Error(`invalid sampled hex: ${cell.hex}`);
    const p = lutIndex(lut, rgb.r, rgb.g, rgb.b);
    cell.hex = availablePalette[p].hex;
    cell.code = availablePalette[p].code;
  }
  onProgress?.(70);
  assertGenerationActive(shouldCancel);
  // 6. 背景识别必须早于合并，避免贴边前景先被并入高频背景色。
  const backgroundClassified = params.backgroundRemoval
    ? removeBackground(sampled, W, M, params.bgTolerance, params.backgroundPrototype ?? undefined, shouldCancel)
    : sampled;
  onProgress?.(82);
  assertGenerationActive(shouldCancel);
  // 7. 只合并实际需要制作的格元；external 背景保持原分类与颜色。
  const merged = mergeByTargetCount(backgroundClassified, availablePalette, params.targetColorCount, shouldCancel);
  const cells = merged.cells;
  onProgress?.(93);
  assertGenerationActive(shouldCancel);
  // 8. 统计
  const stats = computeStats(cells);
  onProgress?.(100);
  assertGenerationActive(shouldCancel);

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
    if (cell.code === null) throw new Error(`cell has no available color code: ${cell.hex}`);
    const existing = byHex.get(cell.hex);
    if (existing) {
      existing.count++;
    } else {
      byHex.set(cell.hex, { code: cell.code, hex: cell.hex, count: 1 });
    }
  }
  return [...byHex.values()].sort((a, b) => {
    const d = b.count - a.count;
    return d !== 0 ? d : a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0;
  });
}
