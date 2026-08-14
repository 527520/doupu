/** 格元采样（spec §F4.3）：主色（平票取先出现者）/平均色；alpha≥128 才计数；全透明格 → transparent。 */
import { rgbToHex } from './color';
import { type ImageDataLike } from './types';
import type { PatternCell, SampleMode } from '@/lib/types';

export function sampleCells(
  imageData: ImageDataLike,
  W: number,
  M: number,
  mode: SampleMode,
): PatternCell[] {
  const { data, width: imgW, height: imgH } = imageData;
  const cells: PatternCell[] = new Array(W * M);
  const cellW = imgW / W;
  const cellH = imgH / M;

  for (let j = 0; j < M; j++) {
    const startY = Math.floor(j * cellH);
    const endY = Math.min(imgH, Math.max(startY + 1, Math.ceil((j + 1) * cellH)));
    for (let i = 0; i < W; i++) {
      const startX = Math.floor(i * cellW);
      const endX = Math.min(imgW, Math.max(startX + 1, Math.ceil((i + 1) * cellW)));

      let count = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      // dominant 模式：RGB 键 → [出现次数, 首次出现序号]
      const freq = new Map<number, [number, number]>();
      let dominantKey = 0;
      let dominantFreq = 0;
      let dominantOrder = Infinity;

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * imgW + x) * 4;
          if (data[idx + 3] < 128) continue;
          count++;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          if (mode === 'average') {
            rSum += r;
            gSum += g;
            bSum += b;
          } else {
            const key = (r << 16) | (g << 8) | b;
            const entry = freq.get(key);
            if (entry) {
              entry[0]++;
            } else {
              freq.set(key, [1, count]);
            }
            const [f, order] = freq.get(key)!;
            if (f > dominantFreq || (f === dominantFreq && order < dominantOrder)) {
              dominantKey = key;
              dominantFreq = f;
              dominantOrder = order;
            }
          }
        }
      }

      if (count === 0) {
        cells[j * W + i] = { hex: null, code: null, transparent: true };
      } else if (mode === 'average') {
        cells[j * W + i] = {
          hex: rgbToHex({ r: rSum / count, g: gSum / count, b: bSum / count }),
          code: null,
          transparent: false,
        };
      } else {
        cells[j * W + i] = {
          hex: rgbToHex({
            r: (dominantKey >> 16) & 0xff,
            g: (dominantKey >> 8) & 0xff,
            b: dominantKey & 0xff,
          }),
          code: null,
          transparent: false,
        };
      }
    }
  }
  return cells;
}
