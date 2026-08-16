// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGenerate, type GenerateRequest, type WorkerResponse } from './runGenerate';
import type { EngineOutput } from './types';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { buildBrandPalette } from '@/lib/palettes';

/** 8×8 红色不透明测试源图。 */
function makeSrc(): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 8 * 8; i++) {
    data[i * 4] = 255;
    data[i * 4 + 3] = 255;
  }
  return { data, width: 8, height: 8 };
}

function makeRequest(): GenerateRequest {
  return {
    src: makeSrc(),
    params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 20 },
    palette: buildBrandPalette('MARD'),
  };
}

const cannedOutput: EngineOutput = {
  pattern: {
    width: 1,
    height: 1,
    cells: [{ hex: '#FFFFFF', code: 'W', transparent: false }],
  },
  stats: [{ code: 'W', hex: '#FFFFFF', count: 1 }],
  totalBeadCount: 1,
  mergeThresholdUsed: 0,
};

/** 可控假 Worker：postMessage 时按注入的行为派发消息。 */
interface FakeWorkerBehavior {
  (request: GenerateRequest, worker: FakeWorker): void;
}

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  readonly posted: GenerateRequest[] = [];
  constructor(
    readonly scriptUrl: string | URL,
    private readonly behavior: FakeWorkerBehavior,
  ) {}
  postMessage(request: GenerateRequest): void {
    this.posted.push(request);
    this.behavior(request, this);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: WorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }
  emitError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function stubWorker(behavior: FakeWorkerBehavior): FakeWorker[] {
  const created: FakeWorker[] = [];
  vi.stubGlobal(
    'Worker',
    class extends FakeWorker {
      constructor(scriptUrl: string | URL) {
        super(scriptUrl, behavior);
        created.push(this);
      }
    },
  );
  return created;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runGenerate 同步回退（无 Worker 环境）', () => {
  it('jsdom 下直接返回正确结果', async () => {
    const task = runGenerate(makeRequest());
    const output = await task.promise;
    expect(output.pattern.width).toBe(20);
    expect(output.pattern.height).toBe(20);
    expect(output.pattern.cells).toHaveLength(400);
    expect(output.totalBeadCount).toBe(400);
  });

  it('onProgress 单调递增且以 100 结束', async () => {
    const percents: number[] = [];
    const task = runGenerate(makeRequest(), (p) => percents.push(p));
    await task.promise;
    expect(percents.length).toBeGreaterThan(0);
    expect(percents[0]).toBeGreaterThan(0);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }
    expect(percents[percents.length - 1]).toBe(100);
  });

  it('cancel 为 no-op（同步路径不可抢占，结果仍正常返回）', async () => {
    const task = runGenerate(makeRequest());
    task.cancel();
    const output = await task.promise;
    expect(output.pattern.width).toBe(20);
  });
});

describe('runGenerate Worker 路径', () => {
  it('转发进度并解析最终结果', async () => {
    const workers = stubWorker((_request, worker) => {
      worker.emit({ type: 'progress', percent: 50 });
      worker.emit({ type: 'progress', percent: 100 });
      worker.emit({ type: 'done', output: cannedOutput });
    });
    const percents: number[] = [];
    const task = runGenerate(makeRequest(), (p) => percents.push(p));
    const output = await task.promise;
    expect(output).toBe(cannedOutput);
    expect(percents).toEqual([50, 100]);
    expect(String(workers[0].scriptUrl)).toContain('generate.worker.ts');
    expect(workers[0].terminated).toBe(true); // 完成后销毁 Worker
  });

  it('worker 执行错误 → 回退主线程同步执行并记录日志', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubWorker((_request, worker) => {
      worker.emit({ type: 'error', error: 'boom' });
    });
    const task = runGenerate(makeRequest());
    const output = await task.promise;
    expect(output.pattern.width).toBe(20); // 保底成功
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(String(errorSpy.mock.calls[0][0])).toContain('回退主线程同步执行');
  });

  it('worker 脚本错误（onerror）→ 回退主线程同步执行', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubWorker((_request, worker) => {
      worker.emitError('script load failed');
    });
    const task = runGenerate(makeRequest());
    const output = await task.promise;
    expect(output.pattern.width).toBe(20);
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('cancel → 立即以 AbortError 拒绝；不强制终止 Worker（Firefox 崩溃规避：丢弃语义）', async () => {
    const workers = stubWorker(() => {
      // 永不回复：模拟长任务
    });
    const task = runGenerate(makeRequest());
    task.cancel();
    await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0].terminated).toBe(false); // 不 terminate（Firefox 会在任务执行中崩溃）
  });

  it('cancel 后迟到的 done 消息不会覆盖取消语义（结果丢弃，Worker 自行销毁）', async () => {
    const workers = stubWorker(() => {
      // 永不回复：模拟长任务
    });
    const task = runGenerate(makeRequest());
    task.cancel();
    // 迟到的 done 消息：promise 保持 AbortError；Worker 在 done 处理器中自行销毁
    workers[0].emit({ type: 'done', output: cannedOutput });
    await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0].terminated).toBe(true);
  });
});
