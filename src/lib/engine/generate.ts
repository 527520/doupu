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
import { availablePaletteColors } from '@/lib/palettes/availability';

/** 每格最多取 4×4 源像素；16 个连续覆盖样本足以保留格内主色/均值，
 * 同时给 200×200 + 291 色的精确 Oklab 抖动留出稳定的 2 秒硬预算。 */
const MAX_SOURCE_PIXELS_PER_CELL = 4;

/** 工作台裁剪可提前收敛到此上限；引擎的最大合法图纸无需更多源像素。 */
export const MAX_GENERATION_SOURCE_DIMENSION = LIMITS.generationSourceDimension;

/** 进度上报（优化票 07）：0→100，按管线阶段单调递增。 */
export type ProgressReporter = (percent: number) => void;

/** 图纸最大行数（spec §F3：M 钳制到 [1, 200]）。 */
export const MAX_PATTERN_ROWS = 200;

/**
 * Reuse immutable cell objects with identical values before crossing the
 * Worker boundary. Structured clone preserves repeated references, reducing a
 * 200x200 result from tens of thousands of cloned objects to at most the
 * palette/status combinations. Editor operations replace array slots and
 * never mutate cell objects, so sharing is safe.
 */
function internPatternCells(cells: PatternCell[]): PatternCell[] {
  const byHex = new Map<string | null, Map<string | null, Array<PatternCell | undefined>>>();
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    let byCode = byHex.get(cell.hex);
    if (!byCode) {
      byCode = new Map();
      byHex.set(cell.hex, byCode);
    }
    let variants = byCode.get(cell.code);
    if (!variants) {
      variants = new Array<PatternCell | undefined>(4);
      byCode.set(cell.code, variants);
    }
    const variant = (cell.transparent ? 1 : 0) | (cell.external ? 2 : 0);
    const canonical = variants[variant];
    if (canonical) cells[index] = canonical;
    else variants[variant] = cell;
  }
  return cells;
}

/**
 * 按原图比例推算图纸行数，并说明是否被上限钳制（A-05）。
 *
 * 竖长图会撞到 200 行上限：例如手机竖屏截图 1080×2400、宽度 100 格时，
 * 按比例应为 222 行，实得 200 行——图纸相对原图纵向压缩约 10%，
 * 而帮助文案写的是「高度按图片比例自动计算」。UI 需要据此明确告知，
 * 并给出「宽度调到多少可保持比例」这个可执行的下一步。
 */
export function patternRows(sourceWidth: number, sourceHeight: number, targetWidth: number): {
  rows: number;
  /** 按比例应有的行数（未钳制） */
  exactRows: number;
  clamped: boolean;
  /** 仍能保持原图比例的最大宽度；已在比例内时等于 targetWidth */
  maxWidthKeepingRatio: number;
} {
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(targetWidth > 0)) {
    return { rows: 1, exactRows: 1, clamped: false, maxWidthKeepingRatio: targetWidth };
  }
  const exactRows = Math.max(1, Math.round((targetWidth * sourceHeight) / sourceWidth));
  const rows = Math.min(MAX_PATTERN_ROWS, exactRows);
  const clamped = exactRows > MAX_PATTERN_ROWS;
  const maxWidthKeepingRatio = clamped
    ? Math.max(1, Math.floor((MAX_PATTERN_ROWS * sourceWidth) / sourceHeight))
    : targetWidth;
  return { rows, exactRows, clamped, maxWidthKeepingRatio };
}

export function generatePattern(
  imageData: ImageDataLike,
  params: GenerationParams,
  palette: PaletteColor[],
  onProgress?: ProgressReporter,
  shouldCancel?: CancellationProbe,
): EngineOutput {
  assertGenerationActive(shouldCancel);
  // 可用性是引擎不变量：null、空白、?、UNKNOWN-* 都是不可采购占位符。
  // 不能把过滤责任留给每个调用方。
  const availablePalette = availablePaletteColors(palette);
  // 对空输入和“过滤后为空”保持同一领域错误，Worker/UI 不需要分辨内部原因。
  if (availablePalette.length === 0) throw new Error('palette is empty');
  const W = params.targetWidth;
  const M = patternRows(imageData.width, imageData.height, W).rows;

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
  internPatternCells(cells);
  onProgress?.(100);
  assertGenerationActive(shouldCancel);

  return {
    pattern: { width: W, height: M, cells },
    stats,
    totalBeadCount: totalBeadCount(stats),
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

/**
 * 用量总数（J-3）：`stats.reduce((sum, item) => sum + item.count, 0)` 此前在
 * 引擎、编辑器状态、工作台（3 处）与 PDF 导出各写一遍，共 6 处。
 */
export function totalBeadCount(stats: readonly PatternStatsItem[]): number {
  let total = 0;
  for (const item of stats) total += item.count;
  return total;
}
