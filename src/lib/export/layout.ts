/** PNG 图纸导出的纯布局计算（spec §F7 PNG 部分；边界 E10/E24–E27）。 */
import type { Pattern, PatternStatsItem } from '@/lib/types';

export const EXPORT_CELL_PX_MIN = 8;
export const EXPORT_CELL_PX_MAX = 48;
export const EXPORT_CELL_PX_DEFAULT = 24;
export const LEGEND_GAP = 16; // 图例区与图纸的间距（px）
export const LEGEND_TEXT_GAP = 8; // 色块与文字间距（px）
export const LEGEND_ENTRY_PADDING = 6; // 每个图例条目的上下留白
export const DEFAULT_DESIGN_NAME = '未命名设计';
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
 * 文件名清洗（规则被测试锁定）：
 * 1. 去首尾空白；为空 → 未命名设计；
 * 2. 非法字符（\/:*?"<>| 与控制字符）→ '-'；
 * 3. 连续 '-' 折叠为一个；4. 去掉首尾 '-'；5. 结果为空 → 未命名设计。
 * 不做截断（名称上限 100 字符由 schema 保证）。
 */
export function sanitizeFilename(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return DEFAULT_DESIGN_NAME;
  const replaced = trimmed.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-');
  const collapsed = replaced.replace(/-{2,}/g, '-');
  const stripped = collapsed.replace(/^-+|-+$/g, '');
  return stripped.length === 0 ? DEFAULT_DESIGN_NAME : stripped;
}

/** 导出文件名：豆谱-<名称>-<W>x<H>.png。 */
export function pngFileName(designName: string, W: number, H: number): string {
  return `豆谱-${sanitizeFilename(designName)}-${W}x${H}.png`;
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
