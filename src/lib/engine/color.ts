/**
 * 颜色工具与 Oklab 感知距离。
 * Oklab 常量移植自 Zippland/perler-beads（AGPL-3.0）src/utils/pixelation.ts，
 * 出处声明见根目录 NOTICE.md。
 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Oklab {
  l: number;
  a: number;
  b: number;
}

/** hex（#RRGGBB）→ RGB；非法输入返回 null。 */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : null;
}

/** RGB → hex（#RRGGBB 大写）。 */
export function rgbToHex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

function computeSrgbChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

// 引擎热路径只传入 8-bit 通道；预计算避免每次精确查询重复执行 3 次幂运算。
// 非整数调用仍走原公式，保持颜色工具的通用行为。
const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, channel) =>
  computeSrgbChannelToLinear(channel),
);

function srgbChannelToLinear(channel: number): number {
  return Number.isInteger(channel) && channel >= 0 && channel <= 255
    ? SRGB_TO_LINEAR[channel]
    : computeSrgbChannelToLinear(channel);
}

/** RGB → Oklab（供 LUT 构建预计算使用）。 */
export function rgbToOklab(rgb: Rgb): Oklab {
  const r = srgbChannelToLinear(rgb.r);
  const g = srgbChannelToLinear(rgb.g);
  const b = srgbChannelToLinear(rgb.b);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

/**
 * Oklab 感知距离（上游公式 ×100 尺度，与合并阈值/背景容差同一尺度）。
 * 结果恒 ≥ 0；同色返回 0。
 */
export function oklabDistance(rgb1: Rgb, rgb2: Rgb): number {
  return Math.sqrt(oklabSquaredDistance(rgbToOklab(rgb1), rgbToOklab(rgb2))) * 100;
}

/** 预计算 Oklab 之间的平方距离（LUT 性能关键路径，不做 ×100 缩放）。 */
export function oklabSquaredDistance(o1: Oklab, o2: Oklab): number {
  const dl = o1.l - o2.l;
  const da = o1.a - o2.a;
  const db = o1.b - o2.b;
  return dl * dl + da * da + db * db;
}
