/** 格元采样（spec §F4.3）：主色/平均色；按连续覆盖面积 × alpha 计权。 */
import { oklabSquaredDistance, rgbToHex, rgbToOklab, type Oklab } from './color';
import { assertGenerationActive, type CancellationProbe, type ImageDataLike } from './types';
import type { PatternCell, SampleMode } from '@/lib/types';

interface DominantSample {
  rgb: { r: number; g: number; b: number };
  lab: Oklab;
  order: number;
}

interface DominantBucket {
  weight: number;
  order: number;
  lSum: number;
  aSum: number;
  bSum: number;
  samples: Map<number, DominantSample>;
}

export function sampleCells(
  imageData: ImageDataLike,
  W: number,
  M: number,
  mode: SampleMode,
  shouldCancel?: CancellationProbe,
): PatternCell[] {
  const { data, width: imgW, height: imgH } = imageData;
  const cells: PatternCell[] = new Array(W * M);
  const cellW = imgW / W;
  const cellH = imgH / M;
  // 抖动输出通常只含色板中的少量 RGB；跨格元复用 Oklab，避免每格重复做立方根转换。
  const labByRgb = new Map<number, Oklab>();

  for (let j = 0; j < M; j++) {
    assertGenerationActive(shouldCancel);
    const cellY0 = j * cellH;
    const cellY1 = (j + 1) * cellH;
    const startY = Math.floor(cellY0);
    const endY = Math.min(imgH, Math.ceil(cellY1));
    for (let i = 0; i < W; i++) {
      const cellX0 = i * cellW;
      const cellX1 = (i + 1) * cellW;
      const startX = Math.floor(cellX0);
      const endX = Math.min(imgW, Math.ceil(cellX1));

      let weight = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      // dominant 模式：5-bit/channel 量化直方图，避免照片噪声使每个 24-bit RGB
      // 都只出现一次时退化为“取扫描顺序第一个像素”。桶内最终取 Oklab medoid。
      const buckets = new Map<number, DominantBucket>();
      let dominantBucket: DominantBucket | null = null;
      let order = 0;
      const cellArea = (cellX1 - cellX0) * (cellY1 - cellY0);

      for (let y = startY; y < endY; y++) {
        const overlapY = Math.max(0, Math.min(cellY1, y + 1) - Math.max(cellY0, y));
        for (let x = startX; x < endX; x++) {
          const idx = (y * imgW + x) * 4;
          const alpha = data[idx + 3] / 255;
          if (alpha === 0) continue;
          const overlapX = Math.max(0, Math.min(cellX1, x + 1) - Math.max(cellX0, x));
          const pixelWeight = overlapX * overlapY * alpha;
          if (pixelWeight === 0) continue;
          order++;
          weight += pixelWeight;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          if (mode === 'average') {
            rSum += r * pixelWeight;
            gSum += g * pixelWeight;
            bSum += b * pixelWeight;
          } else {
            const key = (r << 16) | (g << 8) | b;
            const bucketKey = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
            let bucket = buckets.get(bucketKey);
            if (!bucket) {
              bucket = { weight: 0, order, lSum: 0, aSum: 0, bSum: 0, samples: new Map() };
              buckets.set(bucketKey, bucket);
            }
            let sample = bucket.samples.get(key);
            if (!sample) {
              const rgb = { r, g, b };
              let lab = labByRgb.get(key);
              if (!lab) {
                lab = rgbToOklab(rgb);
                labByRgb.set(key, lab);
              }
              sample = { rgb, lab, order };
              bucket.samples.set(key, sample);
            }
            bucket.weight += pixelWeight;
            bucket.lSum += sample.lab.l * pixelWeight;
            bucket.aSum += sample.lab.a * pixelWeight;
            bucket.bSum += sample.lab.b * pixelWeight;
            if (
              !dominantBucket ||
              bucket.weight > dominantBucket.weight ||
              (bucket.weight === dominantBucket.weight && bucket.order < dominantBucket.order)
            ) {
              dominantBucket = bucket;
            }
          }
        }
      }

      // 保留既有 alpha=128 可见、alpha=127 透明的二值格元契约，
      // 但颜色统计本身使用连续 alpha 权重，避免半透明像素被当作完全不透明。
      if (weight < cellArea * 0.5) {
        cells[j * W + i] = { hex: null, code: null, transparent: true };
      } else if (mode === 'average') {
        cells[j * W + i] = {
          hex: rgbToHex({ r: rSum / weight, g: gSum / weight, b: bSum / weight }),
          code: null,
          transparent: false,
        };
      } else {
        const bucket = dominantBucket!;
        const centroid: Oklab = {
          l: bucket.lSum / bucket.weight,
          a: bucket.aSum / bucket.weight,
          b: bucket.bSum / bucket.weight,
        };
        let representative: DominantSample | null = null;
        let bestDistance = Infinity;
        for (const sample of bucket.samples.values()) {
          const distance = oklabSquaredDistance(sample.lab, centroid);
          if (
            distance < bestDistance ||
            (distance === bestDistance && sample.order < (representative?.order ?? Infinity))
          ) {
            representative = sample;
            bestDistance = distance;
          }
        }
        cells[j * W + i] = {
          hex: rgbToHex(representative!.rgb),
          code: null,
          transparent: false,
        };
      }
    }
  }
  return cells;
}
