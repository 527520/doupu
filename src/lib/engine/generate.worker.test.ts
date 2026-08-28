// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRequest, WorkerResponse } from './runGenerate';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { buildBrandPalette } from '@/lib/palettes';

interface WorkerSelfMock {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
}

let selfMock: WorkerSelfMock;

const source = (): Extract<WorkerRequest, { type: 'source' }> => {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 8 * 8; i++) {
    data[i * 4] = 255;
    data[i * 4 + 3] = 255;
  }
  return { type: 'source', sourceId: 1, src: { data, width: 8, height: 8 } };
};

const generate = (taskId = 1, palette = buildBrandPalette('MARD'), cancelled = false): Extract<WorkerRequest, { type: 'generate' }> => {
  const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  if (cancelled) Atomics.store(new Int32Array(cancelBuffer), 0, 1);
  return {
    type: 'generate',
    taskId,
    sourceId: 1,
    params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 20 },
    palette,
    cancelBuffer,
  };
};

beforeEach(async () => {
  vi.resetModules();
  selfMock = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal('self', selfMock);
  await import('./generate.worker');
});

afterEach(() => vi.unstubAllGlobals());

const dispatch = (request: WorkerRequest): void => {
  selfMock.onmessage?.({ data: request } as MessageEvent<WorkerRequest>);
};
const posted = (): WorkerResponse[] =>
  (selfMock.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);

describe('generate.worker 持久消息协议', () => {
  it('缓存 source，多次 generate 均带 taskId 且进度单调', () => {
    dispatch(source());
    dispatch(generate(7));
    dispatch(generate(8));
    const messages = posted();
    const first = messages.filter((message) => message.taskId === 7);
    const percents = first.filter((message) => message.type === 'progress').map((message) => message.percent);
    expect(percents.at(-1)).toBe(100);
    expect(first.at(-1)).toMatchObject({ type: 'done', taskId: 7 });
    expect(messages.at(-1)).toMatchObject({ type: 'done', taskId: 8 });
  });

  it('原子取消标记使引擎在工作中止点退出，不产生 done/progress', () => {
    dispatch(source());
    dispatch(generate(9, buildBrandPalette('MARD'), true));
    expect(posted()).toEqual([{ type: 'cancelled', taskId: 9 }]);
  });

  it('无 source 和空色板均返回稳定领域错误', () => {
    dispatch(generate(1));
    expect(posted()).toEqual([{ type: 'error', taskId: 1, error: 'generation source is unavailable' }]);
    dispatch(source());
    dispatch(generate(2, []));
    expect(posted().at(-1)).toEqual({ type: 'error', taskId: 2, error: 'palette is empty' });
  });

  it('生成结束 60 秒无新任务即释放 32 MiB 匹配表（A-09）', async () => {
    vi.useFakeTimers();
    try {
      const { lutCacheSize } = await import('./lut');
      dispatch(source());
      dispatch(generate(11));
      expect(lutCacheSize()).toBe(1);
      vi.advanceTimersByTime(59_000);
      expect(lutCacheSize()).toBe(1);
      vi.advanceTimersByTime(2_000);
      expect(lutCacheSize()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('新任务到来会取消待执行的释放（连续调参不会白重建）', async () => {
    vi.useFakeTimers();
    try {
      const { lutCacheSize } = await import('./lut');
      dispatch(source());
      dispatch(generate(12));
      vi.advanceTimersByTime(59_000);
      dispatch(generate(13));
      vi.advanceTimersByTime(2_000);
      expect(lutCacheSize()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
