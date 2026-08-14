/**
 * 背景去除（spec §F4.6）：从所有边界非透明格出发洪泛，
 * 相邻格与当前格 Oklab 距离 < τ 即连通并标记 external（含边界种子本身）。
 * 返回新数组；被标记的格以新对象替换，原输入不被修改。
 */
import { hexToRgb, oklabDistance, type Rgb } from './color';
import type { PatternCell } from '@/lib/types';

export function removeBackground(cells: PatternCell[], W: number, M: number, tau: number): PatternCell[] {
  const next = cells.slice();
  const visited = new Uint8Array(W * M);
  const rgbCache = new Map<string, Rgb>();
  const rgbOf = (cell: PatternCell): Rgb => {
    const hex = cell.hex!;
    let rgb = rgbCache.get(hex);
    if (!rgb) {
      rgb = hexToRgb(hex)!;
      rgbCache.set(hex, rgb);
    }
    return rgb;
  };

  const queue: number[] = [];
  const seed = (index: number): void => {
    if (visited[index] === 1 || next[index].transparent) return;
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
    const cur = queue[head++];
    const curRgb = rgbOf(next[cur]);
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
      if (oklabDistance(curRgb, rgbOf(next[ni])) < tau) {
        visited[ni] = 1;
        next[ni] = { ...next[ni], external: true };
        queue.push(ni);
      }
    }
  }
  return next;
}
