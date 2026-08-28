/**
 * 精确 24-bit RGB 最近色匹配器：以真实 RGB 转 Oklab 后查找最近色，
 * 不再把输入压缩到 15-bit，避免已在色板中的精确色被改配为邻近色号。
 * 查询结果按 24-bit RGB key 缓存；相同色板的匹配器也在模块内复用。
 */
import { hexToRgb, oklabSquaredDistance, rgbToOklab, type Oklab, type Rgb } from './color';
import type { PaletteColor } from '@/lib/types';
import { assertGenerationActive, type CancellationProbe } from './types';

export interface Lut {
  /** 24-bit RGB key → 色板下标 + 1（0 表示尚未计算）的惰性缓存。 */
  indices: Uint16Array;
  palette: PaletteColor[];
  paletteRgbs: Rgb[];
  paletteOklabs: Oklab[];
  /** 仅用于精确查找的初始上界，不作为最终结果。 */
  coarseIndices: Uint16Array;
  tree: KdNode | null;
  /** 查询时复用的栈，避免每个像素创建闭包/数组。 */
  nodeStack: Array<KdNode | null>;
  boundStack: Float64Array;
}

type Axis = 0 | 1 | 2;

interface KdNode {
  index: number;
  axis: Axis;
  left: KdNode | null;
  right: KdNode | null;
}

function coordinate(lab: Oklab, axis: Axis): number {
  return axis === 0 ? lab.l : axis === 1 ? lab.a : lab.b;
}

/** 色板点的平衡 k-d tree；查询仍是精确最近邻，只剪掉不可能更优的子树。 */
function buildTree(indices: number[], labs: Oklab[], depth = 0): KdNode | null {
  if (indices.length === 0) return null;
  const axis = (depth % 3) as Axis;
  indices.sort((a, b) => coordinate(labs[a], axis) - coordinate(labs[b], axis) || a - b);
  const middle = Math.floor(indices.length / 2);
  return {
    index: indices[middle],
    axis,
    left: buildTree(indices.slice(0, middle), labs, depth + 1),
    right: buildTree(indices.slice(middle + 1), labs, depth + 1),
  };
}

function buildLutUncached(palette: PaletteColor[], shouldCancel?: CancellationProbe): Lut {
  if (palette.length === 0) throw new Error('palette is empty');
  if (palette.length >= 0xffff) throw new Error('palette is too large');
  const paletteRgbs = palette.map((color) => {
    const rgb = hexToRgb(color.hex);
    if (!rgb) throw new Error(`invalid palette hex: ${color.hex}`);
    return rgb;
  });
  const paletteOklabs = paletteRgbs.map(rgbToOklab);
  // 65536 个下标页面的稀疏 Map 在抖动图片上会产生数百 MB 对象开销；
  // 紧凑 Uint16Array 覆盖全部 24-bit key 仅 32 MiB，且无需填充 sentinel。
  const indices = new Uint16Array(1 << 24);
  palette.forEach((color, index) => {
    const rgb = paletteRgbs[index];
    const key = (rgb.r << 16) | (rgb.g << 8) | rgb.b;
    if (indices[key] === 0) indices[key] = index + 1;
  });
  // 15-bit 代表点只用来给精确 k-d tree 一个很紧的初始距离上界；
  // 后续仍会用真实 24-bit RGB 验证所有可能更近的分支。
  const coarseIndices = new Uint16Array(1 << 15);
  for (let r5 = 0; r5 < 32; r5++) {
    assertGenerationActive(shouldCancel);
    for (let g5 = 0; g5 < 32; g5++) {
      for (let b5 = 0; b5 < 32; b5++) {
        const coarseKey = (r5 << 10) | (g5 << 5) | b5;
        const target = rgbToOklab({
          r: (r5 << 3) | (r5 >> 2),
          g: (g5 << 3) | (g5 >> 2),
          b: (b5 << 3) | (b5 >> 2),
        });
        let best = 0;
        let bestDistance = Infinity;
        for (let index = 0; index < paletteOklabs.length; index++) {
          const distance = oklabSquaredDistance(target, paletteOklabs[index]);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }
        }
        coarseIndices[coarseKey] = best;
      }
    }
  }
  const tree = buildTree(palette.map((_, index) => index), paletteOklabs);
  return {
    indices,
    palette,
    paletteRgbs,
    paletteOklabs,
    coarseIndices,
    tree,
    nodeStack: new Array<KdNode | null>(palette.length),
    boundStack: new Float64Array(palette.length),
  };
}

const lutCache = new Map<string, Lut>();
/**
 * 缓存容量（A-09）：每套色板的精确表是 `new Uint16Array(1 << 24)` = 32 MiB。
 * 缓存 2 套意味着 Worker 内常驻 64 MiB，在移动端 Safari 上会明显抬高 OOM 概率；
 * 换色板并不频繁，留 1 套即可（配合 releaseIdleLut 在空闲时归零）。
 */
const LUT_CACHE_LIMIT = 1;

/**
 * 缓存键必须包含色号（A-09）：只用 hex 会让「hex 相同、色号不同」的两套色板
 * 共享同一个 Lut，而 Lut 里携带的 `palette` 字段就成了过期数据。
 */
export function lutCacheKey(palette: PaletteColor[]): string {
  return palette.map((color) => `${color.hex}:${color.code ?? ''}`).join(',');
}

export function buildLut(palette: PaletteColor[], shouldCancel?: CancellationProbe): Lut {
  const key = lutCacheKey(palette);
  const cached = lutCache.get(key);
  if (cached) return cached;
  const lut = buildLutUncached(palette, shouldCancel);
  lutCache.set(key, lut);
  if (lutCache.size > LUT_CACHE_LIMIT) {
    const oldest = lutCache.keys().next().value as string | undefined;
    if (oldest !== undefined) lutCache.delete(oldest);
  }
  return lut;
}

/** 清空匹配器缓存（测试隔离、冷启动基准，以及生成空闲时的内存释放）。 */
export function clearLutCache(): void {
  lutCache.clear();
}

/** 当前缓存的匹配表数量（内存占用探针：每套 32 MiB）。 */
export function lutCacheSize(): number {
  return lutCache.size;
}

/** 精确查找：RGB（0–255）→ 色板下标；等距时保留色板中更早的颜色。 */
export function lutIndex(lut: Lut, r: number, g: number, b: number): number {
  const key = (r << 16) | (g << 8) | b;
  const cached = lut.indices[key];
  if (cached !== 0) return cached - 1;

  const target = rgbToOklab({ r, g, b });
  let best = lut.coarseIndices[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
  let bestDistance = oklabSquaredDistance(target, lut.paletteOklabs[best]);
  let top = 0;
  lut.nodeStack[0] = lut.tree;
  lut.boundStack[0] = 0;

  while (top >= 0) {
    const node = lut.nodeStack[top];
    const lowerBound = lut.boundStack[top];
    top--;
    if (!node || lowerBound > bestDistance) continue;
    const distance = oklabSquaredDistance(target, lut.paletteOklabs[node.index]);
    if (distance < bestDistance || (distance === bestDistance && node.index < best)) {
      bestDistance = distance;
      best = node.index;
    }

    const delta = coordinate(target, node.axis) - coordinate(lut.paletteOklabs[node.index], node.axis);
    const near = delta <= 0 ? node.left : node.right;
    const far = delta <= 0 ? node.right : node.left;
    // LIFO：先压远端再压近端，让近端更早收紧 bestDistance。
    if (far) {
      top++;
      lut.nodeStack[top] = far;
      lut.boundStack[top] = delta * delta;
    }
    if (near) {
      top++;
      lut.nodeStack[top] = near;
      lut.boundStack[top] = 0;
    }
  }
  lut.indices[key] = best + 1;
  return best;
}
