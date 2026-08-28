/** PNG 图纸导出的纯布局计算（spec §F7 PNG 部分；边界 E10/E24–E27）。 */
import type { Pattern, PatternStatsItem } from '@/lib/types';
import { buildExportFilename } from './filename';

export const EXPORT_CELL_PX_MIN = 8;
export const EXPORT_CELL_PX_MAX = 48;
export const EXPORT_CELL_PX_DEFAULT = 24;
export const LEGEND_GAP = 16; // 图例区与图纸的间距（px）
export const LEGEND_TEXT_GAP = 8; // 色块与文字间距（px）
export const LEGEND_ENTRY_PADDING = 6; // 每个图例条目的上下留白
export const MAX_EXPORT_CANVAS_DIMENSION = 65_535;
export const MAX_EXPORT_CANVAS_PIXELS = 8192 * 8192;

/** 内容包围盒（含端点）：非透明且非外部格的最小矩形；无内容返回 null。 */
export interface ContentBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function contentBounds(pattern: Pattern): ContentBounds | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const { width, height, cells } = pattern;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y * width + x];
      if (cell.transparent || cell.external) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x0 === Infinity) return null;
  return { x0, y0, x1, y1 };
}

/** 格像素钳制到 [8, 48]；NaN/非数值回退默认 24。 */
export function clampCellPx(value: number): number {
  if (!Number.isFinite(value)) return EXPORT_CELL_PX_DEFAULT;
  const rounded = Math.round(value);
  return Math.min(EXPORT_CELL_PX_MAX, Math.max(EXPORT_CELL_PX_MIN, rounded));
}

/**
 * 文件名清洗与导出文件名统一在 export/filename.ts（J-3：此前 PNG 与 PDF 各一套规则）。
 * 这里重新导出，保持既有 import 路径可用。
 */
export { DEFAULT_DESIGN_NAME, sanitizeFilename } from './filename';

/** 导出文件名：豆谱-<名称>-<W>x<H>.png（规则见 export/filename.ts，PNG/PDF 共用）。 */
export function pngFileName(designName: string, W: number, H: number): string {
  return buildExportFilename(designName, W, H, 'png');
}

/** 图例条目高度：max(16, cellPx + 6)。 */
export function legendEntryHeight(cellPx: number): number {
  return Math.max(16, cellPx + LEGEND_ENTRY_PADDING);
}

/** 每列可容纳的图例条目数（至少 1）。 */
export function legendEntriesPerColumn(cellPx: number, patternHeightPx: number): number {
  return Math.max(1, Math.floor(patternHeightPx / legendEntryHeight(cellPx)));
}

/** 图例列数：条目按列排布（先填满一列再换列），0 条 → 0 列。 */
export function legendColumns(count: number, cellPx: number, patternHeightPx: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / legendEntriesPerColumn(cellPx, patternHeightPx));
}

/** 单列图例宽度：色块 + 文字间距 + 最大文字宽。 */
export function legendColumnWidth(cellPx: number, maxTextWidthPx: number): number {
  return cellPx + LEGEND_TEXT_GAP + maxTextWidthPx;
}

/** 图例文本（色号 × 数量）。 */
export function legendEntryText(item: PatternStatsItem): string {
  return `${item.code} × ${item.count}`;
}

export interface PngCanvasLayout {
  width: number;
  height: number;
  legend: null | {
    x: number;
    y: number;
    columns: number;
    rows: number;
    columnWidth: number;
    entryHeight: number;
  };
}

/** 保守取 Chromium/Firefox/WebKit 可靠交集，避免让浏览器先分配超大背板再失败。 */
export function pngCanvasWithinLimits(size: { width: number; height: number }): boolean {
  return Number.isInteger(size.width)
    && Number.isInteger(size.height)
    && size.width > 0
    && size.height > 0
    && size.width <= MAX_EXPORT_CANVAS_DIMENSION
    && size.height <= MAX_EXPORT_CANVAS_DIMENSION
    && size.width * size.height <= MAX_EXPORT_CANVAS_PIXELS;
}

/**
 * 某个格子档位在当前图纸下是否可导出（A-03）。
 *
 * 200×200 图纸选 48px 会得到 9600² = 92.2 M px，超过 MAX_EXPORT_CANVAS_PIXELS(67.1 M) —— 
 * 旧版把这个档位放在下拉里，用户只会看到「导出失败，请重试」并永远重试失败。
 * 图例文字宽度按 png.ts 无 DOM 时的同一保守估计（cellPx × 4）计算：UI 预判只负责
 * 拦掉必然失败的档位，导出路径的守卫仍是最终判据。
 */
export function pngCellPxFits(input: {
  /** 导出区域的格数（已考虑裁边） */
  contentWidth: number;
  contentHeight: number;
  cellPx: number;
  /** 图例条目数；0 表示不含图例 */
  legendCount: number;
}): boolean {
  const { contentWidth, contentHeight, cellPx, legendCount } = input;
  if (contentWidth <= 0 || contentHeight <= 0) return false;
  const layout = computePngCanvasLayout({
    patternWidthPx: contentWidth * cellPx,
    patternHeightPx: contentHeight * cellPx,
    legendCount,
    cellPx,
    legendTextPx: legendCount > 0 ? cellPx * 4 : 0,
  });
  return pngCanvasWithinLimits(layout);
}

/** 在候选档位中挑出最大的可用档（升序候选；全都不可用时返回最小档）。 */
export function largestFittingCellPx(
  choices: readonly number[],
  input: { contentWidth: number; contentHeight: number; legendCount: number },
): number {
  const ascending = [...choices].sort((a, b) => a - b);
  let best = ascending[0];
  for (const cellPx of ascending) {
    if (pngCellPxFits({ ...input, cellPx })) best = cellPx;
  }
  return best;
}

/** PNG 图例放在图纸下方并按图纸宽度换行，避免极短图纸产生超宽 Canvas。 */
export function computePngCanvasLayout(input: {
  patternWidthPx: number;
  patternHeightPx: number;
  legendCount: number;
  cellPx: number;
  legendTextPx: number;
}): PngCanvasLayout {
  const { patternWidthPx, patternHeightPx, legendCount, cellPx, legendTextPx } = input;
  if (legendCount <= 0) return { width: patternWidthPx, height: patternHeightPx, legend: null };
  const columnWidth = legendColumnWidth(cellPx, legendTextPx);
  const entryHeight = legendEntryHeight(cellPx);
  const columns = Math.min(legendCount, Math.max(1, Math.floor(patternWidthPx / columnWidth)));
  const rows = Math.ceil(legendCount / columns);
  return {
    width: Math.max(patternWidthPx, columns * columnWidth),
    height: patternHeightPx + LEGEND_GAP + rows * entryHeight,
    legend: { x: 0, y: patternHeightPx + LEGEND_GAP, columns, rows, columnWidth, entryHeight },
  };
}
