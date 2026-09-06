/** 缩略图尺寸规则（纯函数，浏览器与服务端共用，服务端渲染与 <img> 的固有尺寸必须一致）。 */

export const THUMBNAIL_TARGET_PX = 720;
export const THUMBNAIL_MIN_CELL_PX = 2;
export const THUMBNAIL_MAX_CELL_PX = 16;

export function thumbnailCellSize(width: number, height: number): number {
  const longest = Math.max(1, width, height);
  return Math.max(THUMBNAIL_MIN_CELL_PX, Math.min(THUMBNAIL_MAX_CELL_PX, Math.floor(THUMBNAIL_TARGET_PX / longest)));
}

export function thumbnailPixelSize(width: number, height: number): { width: number; height: number } {
  const cell = thumbnailCellSize(width, height);
  return { width: Math.max(1, width) * cell, height: Math.max(1, height) * cell };
}
