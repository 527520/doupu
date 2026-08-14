/** 图纸渲染的纯布局计算（spec §F7 渲染规则），供预览与导出共用。 */

export const BOARD_SIZE = 29; // 拼豆板 29×29
export const MIN_LABEL_PX = 12; // 格 ≥12px 才标注色号
export const ZOOM_MIN = 0.5; // 50%
export const ZOOM_MAX = 16; // 1600%

/** 依据亮度选择标注文字颜色（黑/白自适应对比）。 */
export function contrastColor(hex: string): '#000000' | '#FFFFFF' {
  const m = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return '#000000';
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  // WCAG 相对亮度近似
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 150 ? '#FFFFFF' : '#000000';
}

/** 当前格子尺寸下是否标注色号。 */
export function labelVisible(cellPx: number): boolean {
  return cellPx >= MIN_LABEL_PX;
}

/** 图纸按容器等比缩放后的格子像素尺寸（≥1 的整数，取最大适配）。 */
export function fitCellSize(patternW: number, patternH: number, containerW: number, containerH: number): number {
  if (patternW <= 0 || patternH <= 0 || containerW <= 0 || containerH <= 0) return 1;
  return Math.max(1, Math.floor(Math.min(containerW / patternW, containerH / patternH)));
}

/** 板缝线位置（第 29、58… 格之后画粗线，含图纸边界）。 */
export function boardSeamPositions(dim: number): number[] {
  const positions: number[] = [];
  for (let i = BOARD_SIZE; i < dim; i += BOARD_SIZE) positions.push(i);
  return positions;
}

/** 缩放钳制到 [50%, 1600%]；NaN 回退 1（±Infinity 钳到对应边界）。 */
export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** 把画布坐标换算为图纸格子坐标（越界返回 null）。 */
export function pointToCell(
  px: number,
  py: number,
  cellPx: number,
  offsetX: number,
  offsetY: number,
  W: number,
  H: number,
): { row: number; col: number } | null {
  const col = Math.floor((px - offsetX) / cellPx);
  const row = Math.floor((py - offsetY) / cellPx);
  if (col < 0 || col >= W || row < 0 || row >= H) return null;
  return { row, col };
}
