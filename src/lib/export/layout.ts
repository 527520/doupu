/** PNG 图纸导出的基础边界与 Canvas 安全限制。 */
import type { Pattern } from '@/lib/types';
import { buildExportFilename } from './filename';

/** PNG 导出面板可选的格子尺寸；UI 与导出规划共用这一份有序列表。 */
export const EXPORT_CELL_PX_CHOICES = [8, 16, 24, 32, 48] as const;
export const EXPORT_CELL_PX_MIN = EXPORT_CELL_PX_CHOICES[0];
export const EXPORT_CELL_PX_MAX = EXPORT_CELL_PX_CHOICES[EXPORT_CELL_PX_CHOICES.length - 1];
export const EXPORT_CELL_PX_DEFAULT = 24;
/**
 * 这是现代 Chromium、Firefox 与 WebKit 可靠交集形成的领域安全不变量，不是部署调优项。
 * 提高它会直接放大浏览器瞬时内存与崩溃风险，因此不得通过环境变量绕过。
 */
export const MAX_EXPORT_CANVAS_DIMENSION = 8192;
export const MAX_EXPORT_CANVAS_PIXELS = 4096 * 4096;

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
