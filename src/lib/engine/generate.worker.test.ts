// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateRequest, WorkerResponse } from './runGenerate';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { buildBrandPalette } from '@/lib/palettes';

interface WorkerSelfMock {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: unknown) => void;
}

let selfMock: WorkerSelfMock;

/** 8×8 红色不透明测试源图。 */
function makeRequest(palette = buildBrandPalette('MARD')): GenerateRequest {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 8 * 8; i++) {
    data[i * 4] = 255;
    data[i * 4 + 3] = 255;
  }
  return {
    src: { data, width: 8, height: 8 },
    params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 20 },
    palette,
  };
}

beforeEach(async () => {
  vi.resetModules(); // 每次重新执行模块顶层 self.onmessage 赋值
  selfMock = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal('self', selfMock);
  await import('./generate.worker');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function dispatch(request: GenerateRequest): void {
  selfMock.onmessage?.({ data: request } as MessageEvent<unknown>);
}

function posted(): WorkerResponse[] {
  return (selfMock.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
}

describe('generate.worker 消息协议', () => {
  it('成功：按阶段回发单调 progress 并以 done 收尾', () => {
    dispatch(makeRequest());
    const messages = posted();
    expect(messages.length).toBeGreaterThan(1);
    const percents = messages.filter((m) => m.type === 'progress').map((m) => (m as { percent: number }).percent);
    expect(percents[0]).toBeGreaterThan(0);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }
    expect(percents[percents.length - 1]).toBe(100);

    const last = messages[messages.length - 1];
    expect(last.type).toBe('done');
    if (last.type === 'done') {
      expect(last.output.pattern.width).toBe(20);
      expect(last.output.pattern.height).toBe(20);
      expect(last.output.totalBeadCount).toBe(400);
    }
  });

  it('空色板：回发 error 消息（不抛穿 Worker 边界）', () => {
    dispatch(makeRequest([]));
    const messages = posted();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'error', error: 'palette is empty' });
  });
});
