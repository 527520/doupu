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

/** 按长宽双限等比缩小裁剪预览，小图不放大。 */
export function fitCropPreviewSize(
  imageWidth: number,
  imageHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const width = Math.max(1, Math.floor(imageWidth));
  const height = Math.max(1, Math.floor(imageHeight));
  const limitWidth = Math.max(1, Math.floor(maxWidth));
  const limitHeight = Math.max(1, Math.floor(maxHeight));
  const scale = Math.min(1, limitWidth / width, limitHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 构建有界的裁剪预览像素，不复制整幅原图缓冲。 */
export function buildCropPreview(
  image: ImageDataLike,
  maxWidth: number,
  maxHeight: number,
): ImageDataLike {
  const size = fitCropPreviewSize(image.width, image.height, maxWidth, maxHeight);
  const data = new Uint8ClampedArray(size.width * size.height * 4);
  for (let y = 0; y < size.height; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / size.height));
    for (let x = 0; x < size.width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / size.width));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const targetOffset = (y * size.width + x) * 4;
      data[targetOffset] = image.data[sourceOffset];
      data[targetOffset + 1] = image.data[sourceOffset + 1];
      data[targetOffset + 2] = image.data[sourceOffset + 2];
      data[targetOffset + 3] = image.data[sourceOffset + 3];
    }
  }
  return { data, ...size };
}

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
export function applyAspectLock(rect: Rect, ratio: number, anchor: AspectAnchor): Rect {  const rounded: Rect = {
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

/** 边框手柄方向。 */
export type ResizeEdge = 'top' | 'bottom' | 'left' | 'right';

/**
 * 按拖拽的边更新矩形：
 * - 自由模式（ratio 为 null/非法）：仅移动该边（对边固定，另一轴不变）；
 * - 比例锁定：保持宽高比，对边固定、另一轴居中。
 * 结果可能越出图像边界，调用方需再用 clampCropRect 约束。
 */
export function resizeEdge(
  rect: Rect,
  edge: ResizeEdge,
  p: { x: number; y: number },
  ratio: number | null,
  bounds?: { width: number; height: number },
): Rect {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) {
    switch (edge) {
      case 'left':
        return { x: p.x, y: rect.y, width: rect.x + rect.width - p.x, height: rect.height };
      case 'right':
        return { x: rect.x, y: rect.y, width: p.x - rect.x, height: rect.height };
      case 'top':
        return { x: rect.x, y: p.y, width: rect.width, height: rect.y + rect.height - p.y };
      case 'bottom':
        return { x: rect.x, y: rect.y, width: rect.width, height: p.y - rect.y };
    }
  }
  switch (edge) {
    case 'top': {
      const fixedBottom = rect.y + rect.height;
      const centerX = rect.x + rect.width / 2;
      const maxHeightByWidth = bounds
        ? Math.floor((2 * Math.min(centerX, bounds.width - centerX)) / ratio)
        : Infinity;
      const maxHeightByEdge = bounds ? Math.floor(fixedBottom) : Infinity;
      const height = Math.max(1, Math.min(Math.round(fixedBottom - p.y), maxHeightByWidth, maxHeightByEdge));
      const width = Math.max(1, Math.round(height * ratio));
      return { x: Math.round(centerX - width / 2), y: Math.round(fixedBottom - height), width, height };
    }
    case 'bottom': {
      const centerX = rect.x + rect.width / 2;
      const maxHeightByWidth = bounds
        ? Math.floor((2 * Math.min(centerX, bounds.width - centerX)) / ratio)
        : Infinity;
      const maxHeightByEdge = bounds ? Math.floor(bounds.height - rect.y) : Infinity;
      const height = Math.max(1, Math.min(Math.round(p.y - rect.y), maxHeightByWidth, maxHeightByEdge));
      const width = Math.max(1, Math.round(height * ratio));
      return { x: Math.round(centerX - width / 2), y: rect.y, width, height };
    }
    case 'left': {
      const fixedRight = rect.x + rect.width;
      const centerY = rect.y + rect.height / 2;
      const maxWidthByHeight = bounds
        ? Math.floor(2 * Math.min(centerY, bounds.height - centerY) * ratio)
        : Infinity;
      const maxWidthByEdge = bounds ? Math.floor(fixedRight) : Infinity;
      const width = Math.max(1, Math.min(Math.round(fixedRight - p.x), maxWidthByHeight, maxWidthByEdge));
      const height = Math.max(1, Math.round(width / ratio));
      return { x: Math.round(fixedRight - width), y: Math.round(centerY - height / 2), width, height };
    }
    case 'right': {
      const centerY = rect.y + rect.height / 2;
      const maxWidthByHeight = bounds
        ? Math.floor(2 * Math.min(centerY, bounds.height - centerY) * ratio)
        : Infinity;
      const maxWidthByEdge = bounds ? Math.floor(bounds.width - rect.x) : Infinity;
      const width = Math.max(1, Math.min(Math.round(p.x - rect.x), maxWidthByHeight, maxWidthByEdge));
      const height = Math.max(1, Math.round(width / ratio));
      return { x: rect.x, y: Math.round(centerY - height / 2), width, height };
    }
  }
}

/**
 * 裁剪像素。默认逐行精确复制；传入 maxDimension 时直接用连续覆盖面积 × alpha
 * 的盒式采样到工作分辨率，避免点采样混叠，也不先分配可能达到数百 MB 的裁剪缓冲。
 * 传入矩形与图像**求交**（不移动、不拉伸）：越界部分被裁掉，全在界外则返回 0×0。
 */
export function cropImageData(image: ImageDataLike, rect: Rect, maxDimension = Infinity): ImageDataLike {
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

  const boundedMax = Number.isFinite(maxDimension) ? Math.max(1, Math.floor(maxDimension)) : Infinity;
  const scale = Math.min(1, boundedMax / Math.max(1, width, height));
  const targetWidth = width === 0 ? 0 : Math.max(1, Math.round(width * scale));
  const targetHeight = height === 0 ? 0 : Math.max(1, Math.round(height * scale));

  if (targetWidth !== width || targetHeight !== height) {
    const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    const startByX = new Float64Array(targetWidth);
    const endByX = new Float64Array(targetWidth);
    const floorByX = new Int32Array(targetWidth);
    const ceilByX = new Int32Array(targetWidth);
    const firstWeightByX = new Float64Array(targetWidth);
    const lastWeightByX = new Float64Array(targetWidth);
    for (let targetX = 0; targetX < targetWidth; targetX++) {
      const start = x1 + (targetX * width) / targetWidth;
      const end = x1 + ((targetX + 1) * width) / targetWidth;
      startByX[targetX] = start;
      endByX[targetX] = end;
      floorByX[targetX] = Math.floor(start);
      ceilByX[targetX] = Math.ceil(end);
      if (ceilByX[targetX] - floorByX[targetX] === 1) {
        firstWeightByX[targetX] = end - start;
        lastWeightByX[targetX] = end - start;
      } else {
        firstWeightByX[targetX] = floorByX[targetX] + 1 - start;
        lastWeightByX[targetX] = end - (ceilByX[targetX] - 1);
      }
    }
    for (let targetY = 0; targetY < targetHeight; targetY++) {
      const sourceY0 = y1 + (targetY * height) / targetHeight;
      const sourceY1 = y1 + ((targetY + 1) * height) / targetHeight;
      const sourceFloorY = Math.floor(sourceY0);
      const sourceCeilY = Math.ceil(sourceY1);
      const singleSourceRow = sourceCeilY - sourceFloorY === 1;
      const firstWeightY = singleSourceRow ? sourceY1 - sourceY0 : sourceFloorY + 1 - sourceY0;
      const lastWeightY = singleSourceRow ? firstWeightY : sourceY1 - (sourceCeilY - 1);
      for (let targetX = 0; targetX < targetWidth; targetX++) {
        const sourceX0 = startByX[targetX];
        const sourceX1 = endByX[targetX];
        let red = 0;
        let green = 0;
        let blue = 0;
        let alphaWeight = 0;
        for (let sourceY = sourceFloorY; sourceY < sourceCeilY; sourceY++) {
          const overlapY = sourceY === sourceFloorY
            ? firstWeightY
            : sourceY === sourceCeilY - 1 ? lastWeightY : 1;
          for (let sourceX = floorByX[targetX]; sourceX < ceilByX[targetX]; sourceX++) {
            const overlapX = sourceX === floorByX[targetX]
              ? firstWeightByX[targetX]
              : sourceX === ceilByX[targetX] - 1 ? lastWeightByX[targetX] : 1;
            const index = (sourceY * w + sourceX) * 4;
            const weight = overlapX * overlapY * (image.data[index + 3] / 255);
            if (weight === 0) continue;
            red += image.data[index] * weight;
            green += image.data[index + 1] * weight;
            blue += image.data[index + 2] * weight;
            alphaWeight += weight;
          }
        }
        const targetIndex = (targetY * targetWidth + targetX) * 4;
        if (alphaWeight > 0) {
          out[targetIndex] = Math.round(red / alphaWeight);
          out[targetIndex + 1] = Math.round(green / alphaWeight);
          out[targetIndex + 2] = Math.round(blue / alphaWeight);
        }
        const area = (sourceX1 - sourceX0) * (sourceY1 - sourceY0);
        out[targetIndex + 3] = Math.round((alphaWeight / area) * 255);
      }
    }
    return { data: out, width: targetWidth, height: targetHeight };
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row++) {
    const srcStart = ((y1 + row) * w + x1) * 4;
    out.set(image.data.subarray(srcStart, srcStart + rowBytes), row * rowBytes);
  }
  return { data: out, width, height };
}
