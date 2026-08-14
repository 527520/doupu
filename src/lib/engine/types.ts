/** 引擎公共类型（纯数据，与浏览器 ImageData 结构兼容）。 */
import type { Pattern, PatternStatsItem } from '@/lib/types';

export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface EngineOutput {
  pattern: Pattern;
  stats: PatternStatsItem[];
  totalBeadCount: number;
  mergeThresholdUsed: number;
}

export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
