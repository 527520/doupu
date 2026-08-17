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

export type CancellationProbe = () => boolean;

export function assertGenerationActive(probe?: CancellationProbe): void {
  if (!probe?.()) return;
  const error = new Error('生成任务已取消');
  error.name = 'AbortError';
  throw error;
}

export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
