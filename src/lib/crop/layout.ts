/**
 * 裁剪矩形纯几何逻辑（spec §F2；边界 E9/E14 相关裁剪部分）。
 * 无 DOM 依赖，供 ImageCropper 组件与单测共用。
 */

/** 与浏览器 ImageData 结构兼容的像素缓冲。 */
export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 轴对齐整数矩形（像素坐标）。 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 最小选区尺寸（像素，spec §F2 验收标准）。 */
export const MIN_CROP_SIZE = 4;

/** 比例锁定的锚点。 */
export type AspectAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

/**
 * 将任意矩形约束到图像范围内：
 * - 坐标取整；宽高取整且不小于 minSize（图像本身更小则取图像尺寸）；
 * - 宽高不超过图像尺寸；位置平移回图像内。
 * 对 0×0 图像、负宽高、越界矩形均安全（E9 极宽图、1×1 图）。
 */
export function clampCropRect(
  rect: Rect,
  imageWidth: number,
  imageHeight: number,
  minSize: number = MIN_CROP_SIZE,
): Rect {
  const w = Math.max(0, Math.floor(imageWidth));
  const h = Math.max(0, Math.floor(imageHeight));

  const minW = Math.min(Math.max(0, Math.floor(minSize)), w);
  const minH = Math.min(Math.max(0, Math.floor(minSize)), h);

  let width = Math.round(rect.width);
  let height = Math.round(rect.height);
  width = Math.min(Math.max(width, minW), w);
  height = Math.min(Math.max(height, minH), h);

  let x = Math.round(rect.x);
  let y = Math.round(rect.y);
  x = Math.min(Math.max(x, 0), w - width);
  y = Math.min(Math.max(y, 0), h - height);

  return { x, y, width, height };
}

/**
 * 按目标宽高比调整矩形尺寸，保持锚点不动。
 * ratio 为宽/高；非法 ratio（非有限正数）原样返回。
 * 结果可能越出图像边界，调用方需再用 clampCropRect 约束。
 */
export function applyAspectLock(rect: Rect, ratio: number, anchor: AspectAnchor): Rect {
  const rounded: Rect = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
  // 非法 ratio：原样返回（取整）
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return { ...rounded, width: Math.max(1, rounded.width), height: Math.max(1, rounded.height) };
  }
  // 零尺寸矩形：强制最小 1×1（比例锁不产生 0 尺寸）
  if (rounded.width <= 0 || rounded.height <= 0) {
    return { ...rounded, width: Math.max(1, rounded.width), height: Math.max(1, rounded.height) };
  }

  const current = rounded.width / rounded.height;
  let width: number;
  let height: number;
  if (current > ratio) {
    // 太宽：收缩宽度
    height = rounded.height;
    width = Math.round(rounded.height * ratio);
  } else {
    // 太高：收缩高度
    width = rounded.width;
    height = Math.round(rounded.width / ratio);
  }
  width = Math.max(1, width);
  height = Math.max(1, height);

  let x: number;
  let y: number;
  switch (anchor) {
    case 'top-left':
      x = rounded.x;
      y = rounded.y;
      break;
    case 'top-right':
      x = rounded.x + rounded.width - width;
      y = rounded.y;
      break;
    case 'bottom-left':
      x = rounded.x;
      y = rounded.y + rounded.height - height;
      break;
    case 'bottom-right':
      x = rounded.x + rounded.width - width;
      y = rounded.y + rounded.height - height;
      break;
    case 'center':
      x = rounded.x + Math.round((rounded.width - width) / 2);
      y = rounded.y + Math.round((rounded.height - height) / 2);
      break;
  }
  return { x: Math.round(x), y: Math.round(y), width, height };
}

/**
 * 精确裁剪像素（逐行复制，保留 alpha；透明 PNG 裁剪后 alpha 不变，spec §F2）。
 * 传入矩形与图像**求交**（不移动、不拉伸）：越界部分被裁掉，全在界外则返回 0×0。
 */
export function cropImageData(image: ImageDataLike, rect: Rect): ImageDataLike {
  const w = Math.max(0, Math.floor(image.width));
  const h = Math.max(0, Math.floor(image.height));
  const rx = Math.round(rect.x);
  const ry = Math.round(rect.y);
  const x1 = Math.max(0, rx);
  const y1 = Math.max(0, ry);
  const x2 = Math.min(w, rx + Math.round(rect.width));
  const y2 = Math.min(h, ry + Math.round(rect.height));
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);

  const out = new Uint8ClampedArray(width * height * 4);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row++) {
    const srcStart = ((y1 + row) * w + x1) * 4;
    out.set(image.data.subarray(srcStart, srcStart + rowBytes), row * rowBytes);
  }
  return { data: out, width, height };
}
