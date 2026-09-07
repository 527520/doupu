/** 缩略图尺寸规则（纯函数，浏览器与服务端共用，服务端渲染与 <img> 的固有尺寸必须一致）。 */

export const THUMBNAIL_TARGET_PX = 720;
export const THUMBNAIL_MIN_CELL_PX = 2;
export const THUMBNAIL_MAX_CELL_PX = 16;
/** 详情页匿名访客看的大图（ADR-0021）：长边 1440px，格子最大 28px，同样带格线与板缝、不带色号。 */
export const THUMBNAIL_LARGE_TARGET_PX = 1440;
export const THUMBNAIL_LARGE_MAX_CELL_PX = 28;

export type ThumbnailSize = 'default' | 'large';

function limits(size: ThumbnailSize): { target: number; maxCell: number } {
  return size === 'large' ? { target: THUMBNAIL_LARGE_TARGET_PX, maxCell: THUMBNAIL_LARGE_MAX_CELL_PX } : { target: THUMBNAIL_TARGET_PX, maxCell: THUMBNAIL_MAX_CELL_PX };
}

export function thumbnailCellSize(width: number, height: number, size: ThumbnailSize = 'default'): number {
  const { target, maxCell } = limits(size);
  const longest = Math.max(1, width, height);
  return Math.max(THUMBNAIL_MIN_CELL_PX, Math.min(maxCell, Math.floor(target / longest)));
}

export function thumbnailPixelSize(width: number, height: number, size: ThumbnailSize = 'default'): { width: number; height: number } {
  const cell = thumbnailCellSize(width, height, size);
  return { width: Math.max(1, width) * cell, height: Math.max(1, height) * cell };
}
