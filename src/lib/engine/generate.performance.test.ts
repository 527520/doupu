import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { getBuiltinPalette } from '@/lib/palettes';
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from '@/lib/types';
import { generatePattern } from './generate';
import { clearLutCache } from './lut';
import type { ImageDataLike } from './types';

function randomImage(seed: number, width: number, height: number): ImageDataLike {
  let state = seed >>> 0;
  const random = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.floor(random() * 256);
    data[i + 1] = Math.floor(random() * 256);
    data[i + 2] = Math.floor(random() * 256);
    data[i + 3] = 255;
  }
  return { data, width, height };
}

describe('生成引擎性能预算（无 coverage instrumentation）', () => {
  it('真实工作线程在取消标记写入后 100ms 内停止 CPU 计算', async () => {
    const worker = new Worker(
      new URL('../../../tests/ci/generation-cancel.worker.ts', import.meta.url),
      { execArgv: ['--import', 'tsx'] },
    );
    const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const cancelView = new Int32Array(cancelBuffer);
    let cancelledAt = 0;
    const stopped = new Promise<{ name: string; stoppedAt: number }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('worker did not stop after cancellation')), 2_000);
      worker.on('error', reject);
      worker.on('message', (message: { type: string; percent?: number; name?: string; stoppedAt?: number }) => {
        if (message.type === 'progress' && message.percent === 28 && cancelledAt === 0) {
          cancelledAt = performance.now();
          Atomics.store(cancelView, 0, 1);
        }
        if (message.type === 'unexpected-complete') reject(new Error('worker completed instead of observing cancellation'));
        if (message.type === 'stopped') {
          clearTimeout(timeout);
          resolve({ name: message.name ?? '', stoppedAt: message.stoppedAt ?? Infinity });
        }
      });
    });
    worker.postMessage({ cancelBuffer });
    try {
      const result = await stopped;
      expect(cancelledAt).toBeGreaterThan(0);
      expect(result.name).toBe('AbortError');
      expect(result.stoppedAt - cancelledAt).toBeLessThan(100);
    } finally {
      await worker.terminate();
    }
  }, 5_000);

  it('200×200 图纸 + 291 色色板 < 2000ms（spec §7.1）', () => {
    const params: GenerationParams = {
      ...DEFAULT_GENERATION_PARAMS,
      targetWidth: 200,
      dithering: true,
    };
    const image = randomImage(42, 1600, 1600);
    clearLutCache(); // 生产 Worker 每个任务都是冷启动，基准必须包含 matcher 构建
    const start = performance.now();
    const output = generatePattern(image, params, [...getBuiltinPalette('MARD').engineColors]);
    const elapsed = performance.now() - start;

    expect(output.pattern.width).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });
});
