// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disposeGenerateWorker,
  createGenerateWorkerClient,
  prepareGenerationSource,
  runGenerate,
  type GenerateRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './runGenerate';
import type { EngineOutput, ImageDataLike } from './types';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { getBuiltinPalette } from '@/lib/palettes';

function makeSrc(red = 255): ImageDataLike {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 8 * 8; i++) {
    data[i * 4] = red;
    data[i * 4 + 3] = 255;
  }
  return { data, width: 8, height: 8 };
}

function makeRequest(src = makeSrc()): GenerateRequest {
  return {
    src,
    params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 20 },
    palette: [...getBuiltinPalette('MARD').engineColors],
  };
}

const cannedOutput: EngineOutput = {
  pattern: { width: 1, height: 1, cells: [{ hex: '#FFFFFF', code: 'W', transparent: false }] },
  stats: [{ code: 'W', hex: '#FFFFFF', count: 1 }],
  totalBeadCount: 1,
  mergeThresholdUsed: 0,
};

type FakeWorkerBehavior = (request: WorkerRequest, worker: FakeWorker) => void;

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  readonly posted: WorkerRequest[] = [];
  readonly transferLists: Transferable[][] = [];
  constructor(readonly scriptUrl: string | URL, private readonly behavior: FakeWorkerBehavior) {}
  postMessage(request: WorkerRequest, transfer: Transferable[] = []): void {
    this.posted.push(request);
    this.transferLists.push(transfer);
    this.behavior(request, this);
  }
  terminate(): void { this.terminated = true; }
  emit(message: WorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }
  emitError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function stubWorker(behavior: FakeWorkerBehavior): FakeWorker[] {
  const created: FakeWorker[] = [];
  vi.stubGlobal('Worker', class extends FakeWorker {
    constructor(scriptUrl: string | URL) {
      super(scriptUrl, behavior);
      created.push(this);
    }
  });
  return created;
}

afterEach(() => {
  disposeGenerateWorker();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runGenerate 同步回退（无 Worker 环境）', () => {
  it('jsdom 下直接返回正确结果', async () => {
    const output = await runGenerate(makeRequest()).promise;
    expect(output.pattern.width).toBe(20);
    expect(output.totalBeadCount).toBe(400);
  });

  it('计算开始前取消会立即 AbortError', async () => {
    const task = runGenerate(makeRequest());
    task.cancel();
    await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('runGenerate 持久 Worker 协议', () => {
  it('把有界源图收敛为一份 session/Worker 共享缓冲', () => {
    const original = makeSrc();
    const shared = prepareGenerationSource(original);
    expect(shared.data.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(shared.data.buffer).not.toBe(original.data.buffer);
    expect(shared.data).toEqual(original.data);
    expect(prepareGenerationSource(shared)).toBe(shared);
  });

  it('复用一个 Worker，同一 source 只初始化一次', async () => {
    const workers = stubWorker((request, worker) => {
      if (request.type === 'generate') worker.emit({ type: 'done', taskId: request.taskId, output: cannedOutput });
    });
    const src = makeSrc();
    await runGenerate(makeRequest(src)).promise;
    await runGenerate(makeRequest(src)).promise;

    expect(workers).toHaveLength(1);
    expect(workers[0].posted.map((message) => message.type)).toEqual(['source', 'generate', 'generate']);
    expect(workers[0].terminated).toBe(false);
  });

  it('共享 source 只发送句柄一次，不创建或 transfer 第二份 RGBA', async () => {
    const workers = stubWorker((request, worker) => {
      if (request.type === 'generate') worker.emit({ type: 'done', taskId: request.taskId, output: cannedOutput });
    });
    const src = prepareGenerationSource(makeSrc());
    await runGenerate(makeRequest(src)).promise;

    const source = workers[0].posted[0];
    expect(source.type).toBe('source');
    if (source.type !== 'source') throw new Error('expected source message');
    expect(source.src.data.buffer).toBe(src.data.buffer);
    expect(workers[0].transferLists[0]).toEqual([]);
    expect(src.data.byteLength).toBe(8 * 8 * 4);
  });

  it('更换 source 只重发 source，不重建 Worker', async () => {
    const workers = stubWorker((request, worker) => {
      if (request.type === 'generate') worker.emit({ type: 'done', taskId: request.taskId, output: cannedOutput });
    });
    await runGenerate(makeRequest(makeSrc(255))).promise;
    await runGenerate(makeRequest(makeSrc(128))).promise;
    expect(workers).toHaveLength(1);
    expect(workers[0].posted.filter((message) => message.type === 'source')).toHaveLength(2);
  });

  it('多个实例各自拥有 Worker，任务不会互相取消', async () => {
    const workers = stubWorker(() => undefined);
    const left = createGenerateWorkerClient();
    const right = createGenerateWorkerClient();
    const leftTask = left.run(makeRequest());
    const rightTask = right.run(makeRequest());
    expect(workers).toHaveLength(2);
    const leftMessage = workers[0].posted.find((message): message is Extract<WorkerRequest, { type: 'generate' }> => message.type === 'generate')!;
    const rightMessage = workers[1].posted.find((message): message is Extract<WorkerRequest, { type: 'generate' }> => message.type === 'generate')!;
    workers[0].emit({ type: 'done', taskId: leftMessage.taskId, output: cannedOutput });
    workers[1].emit({ type: 'done', taskId: rightMessage.taskId, output: cannedOutput });
    await expect(Promise.all([leftTask.promise, rightTask.promise])).resolves.toEqual([cannedOutput, cannedOutput]);
    left.dispose(); right.dispose();
  });

  it('原子取消立即拒绝且不排队冗余 cancel 消息，持久 Worker 保留', async () => {
    const workers = stubWorker(() => undefined);
    const task = runGenerate(makeRequest());
    const generate = workers[0].posted.find(
      (request): request is Extract<WorkerRequest, { type: 'generate' }> => request.type === 'generate',
    );
    const started = performance.now();
    task.cancel();
    await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(performance.now() - started).toBeLessThan(100);
    expect(generate?.cancelBuffer).toBeInstanceOf(SharedArrayBuffer);
    expect(Atomics.load(new Int32Array(generate?.cancelBuffer as SharedArrayBuffer), 0)).toBe(1);
    expect(workers[0].terminated).toBe(false);
    expect(workers[0].posted.map((message) => message.type)).toEqual(['source', 'generate']);
  });

  it('新任务自动取消旧任务，迟到结果不能覆盖 latest-only 语义', async () => {
    const workers = stubWorker(() => undefined);
    const first = runGenerate(makeRequest());
    const second = runGenerate(makeRequest());
    await expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });
    const messages = workers[0].posted.filter((message): message is Extract<WorkerRequest, { type: 'generate' }> => message.type === 'generate');
    workers[0].emit({ type: 'done', taskId: messages[0].taskId, output: cannedOutput });
    workers[0].emit({ type: 'done', taskId: messages[1].taskId, output: cannedOutput });
    await expect(second.promise).resolves.toBe(cannedOutput);
  });

  it('worker 脚本错误拒绝任务并销毁损坏的 Worker', async () => {
    const workers = stubWorker((request, worker) => {
      if (request.type === 'generate') worker.emitError('script load failed');
    });
    await expect(runGenerate(makeRequest()).promise).rejects.toThrow('script load failed');
    expect(workers[0].terminated).toBe(true);
  });
});
