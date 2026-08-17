/**
 * 背景去除（spec §F4.6）：自动模式从四角多数共识选出固定背景原型，
 * 仅让与该原型距离 < τ 的边界/连通格进入洪泛；也可显式传入背景色原型。
 * 固定原型可避免沿渐变逐格漂移到前景。返回新数组，不修改输入。
 */
import { hexToRgb, oklabDistance, type Rgb } from './color';
import type { PatternCell } from '@/lib/types';
import { assertGenerationActive, type CancellationProbe } from './types';

export function removeBackground(
  cells: PatternCell[],
  W: number,
  M: number,
  tau: number,
  prototypeHex?: string,
  shouldCancel?: CancellationProbe,
): PatternCell[] {
  const next = cells.slice();
  const visited = new Uint8Array(W * M);
  const rgbCache = new Map<string, Rgb>();
  const rgbOf = (cell: PatternCell): Rgb | null => {
    const hex = cell.hex;
    if (hex === null) return null;
    let rgb = rgbCache.get(hex);
    if (!rgb) {
      const parsed = hexToRgb(hex);
      if (!parsed) return null;
      rgb = parsed;
      rgbCache.set(hex, rgb);
    }
    return rgb;
  };

  let prototype: Rgb;
  if (prototypeHex !== undefined) {
    const parsed = hexToRgb(prototypeHex);
    if (!parsed) throw new Error(`invalid background prototype hex: ${prototypeHex}`);
    prototype = parsed;
  } else {
    const cornerIndices = [...new Set([0, W - 1, (M - 1) * W, M * W - 1])];
    const candidates: Rgb[] = [];
    for (const index of cornerIndices) {
      if (next[index].transparent) continue;
      const rgb = rgbOf(next[index]);
      if (rgb) candidates.push(rgb);
    }
    if (candidates.length === 0) return next;
    let bestIndex = 0;
    let bestCount = 0;
    for (let i = 0; i < candidates.length; i++) {
      let count = 1;
      for (let j = 0; j < candidates.length; j++) {
        if (i !== j && oklabDistance(candidates[i], candidates[j]) < tau) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        bestIndex = i;
      }
    }
    if (bestCount <= candidates.length / 2) return next;
    prototype = candidates[bestIndex];
  }

  const queue: number[] = [];
  const seed = (index: number): void => {
    if (visited[index] === 1 || next[index].transparent) return;
    const rgb = rgbOf(next[index]);
    if (!rgb || oklabDistance(prototype, rgb) >= tau) return;
    visited[index] = 1;
    next[index] = { ...next[index], external: true };
    queue.push(index);
  };

  // 边界种子
  for (let x = 0; x < W; x++) {
    seed(x);
    seed((M - 1) * W + x);
  }
  for (let y = 0; y < M; y++) {
    seed(y * W);
    seed(y * W + W - 1);
  }

  let head = 0;
  while (head < queue.length) {
    if ((head & 255) === 0) assertGenerationActive(shouldCancel);
    const cur = queue[head++];
    const cx = cur % W;
    const cy = (cur / W) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= M) continue;
      const ni = ny * W + nx;
      if (visited[ni] === 1 || next[ni].transparent) continue;
      const nextRgb = rgbOf(next[ni]);
      if (nextRgb && oklabDistance(prototype, nextRgb) < tau) {
        visited[ni] = 1;
        next[ni] = { ...next[ni], external: true };
        queue.push(ni);
      }
    }
  }
  return next;
}
