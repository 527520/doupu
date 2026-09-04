/** Persistent latest-only generation worker client. */
import { generatePattern, type ProgressReporter } from './generate';
import { type EngineOutput, type ImageDataLike } from './types';
import type { GenerationParams, PaletteColor } from '@/lib/types';

export interface GenerateRequest {
  src: ImageDataLike;
  params: GenerationParams;
  palette: PaletteColor[];
}

export type WorkerRequest =
  | { type: 'source'; sourceId: number; src: ImageDataLike }
  | {
      type: 'generate';
      taskId: number;
      sourceId: number;
      params: GenerationParams;
      palette: PaletteColor[];
      cancelBuffer?: SharedArrayBuffer;
    }
  | { type: 'cancel'; taskId: number };

export type WorkerResponse =
  | { type: 'progress'; taskId: number; percent: number }
  | { type: 'done'; taskId: number; output: EngineOutput }
  | { type: 'error'; taskId: number; error: string }
  | { type: 'cancelled'; taskId: number };

export interface GenerateTask {
  promise: Promise<EngineOutput>;
  cancel: () => void;
}

const isSharedSource = (src: ImageDataLike): boolean =>
  typeof SharedArrayBuffer !== 'undefined' && src.data.buffer instanceof SharedArrayBuffer;

/**
 * Move the bounded crop into one cross-thread shared allocation. The session
 * and persistent Worker then reference the same immutable bytes, so changing
 * parameters never clones or retransmits the RGBA source. Older/non-isolated
 * browsers fall back to the transfer-copy path inside runGenerate.
 */
export function prepareGenerationSource(src: ImageDataLike): ImageDataLike {
  if (isSharedSource(src)) return src;
  try {
    if (typeof SharedArrayBuffer === 'undefined') return src;
    const shared = new Uint8ClampedArray(new SharedArrayBuffer(src.data.byteLength));
    shared.set(src.data);
    return { ...src, data: shared };
  } catch {
    return src;
  }
}

interface ActiveWorkerTask {
  taskId: number;
  settled: boolean;
  cancelView: Int32Array | null;
  onProgress?: ProgressReporter;
  resolve: (output: EngineOutput) => void;
  reject: (error: Error) => void;
  cancel: () => void;
}

const abortError = (): Error => {
  const error = new Error('生成任务已取消');
  error.name = 'AbortError';
  return error;
};

function createCancelView(): Int32Array | null {
  try {
    if (typeof SharedArrayBuffer === 'undefined') return null;
    return new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  } catch {
    return null;
  }
}

function synchronousTask(request: GenerateRequest, onProgress?: ProgressReporter): GenerateTask {
  let settled = false;
  let cancelled = false;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<EngineOutput>((resolve, reject) => {
    rejectPromise = reject;
    queueMicrotask(() => {
      if (settled || cancelled) return;
      try {
        const output = generatePattern(request.src, request.params, request.palette, onProgress, () => cancelled);
        if (settled || cancelled) return;
        settled = true;
        resolve(output);
      } catch (error) {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error('生成失败'));
      }
    });
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      cancelled = true;
      settled = true;
      rejectPromise(abortError());
    },
  };
}

export interface GenerateWorkerClient {
  run(request: GenerateRequest, onProgress?: ProgressReporter): GenerateTask;
  dispose(): void;
}

/** One persistent latest-only Worker. Batch production owns up to two instances. */
export function createGenerateWorkerClient(): GenerateWorkerClient {
  let persistentWorker: Worker | null = null;
  let persistentSource: ImageDataLike | null = null;
  let sourceId = 0;
  let taskId = 0;
  let activeTask: ActiveWorkerTask | null = null;

  const terminate = () => {
    persistentWorker?.terminate();
    persistentWorker = null;
    persistentSource = null;
    sourceId += 1;
  };
  const rejectActive = (error: Error) => {
    const task = activeTask;
    if (!task || task.settled) return;
    task.settled = true;
    activeTask = null;
    task.reject(error);
  };
  const ensureWorker = (): Worker => {
    if (persistentWorker) return persistentWorker;
    const worker = new Worker(new URL('./generate.worker.ts', import.meta.url));
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const task = activeTask;
      if (!task || task.settled || task.taskId !== message.taskId) return;
      if (message.type === 'progress') { task.onProgress?.(message.percent); return; }
      task.settled = true;
      activeTask = null;
      if (message.type === 'done') task.resolve(message.output);
      else if (message.type === 'cancelled') task.reject(abortError());
      else task.reject(new Error(message.error));
    };
    worker.onerror = (event) => { rejectActive(new Error(event.message || 'worker 生成失败')); terminate(); };
    persistentWorker = worker;
    return worker;
  };

  const run = (request: GenerateRequest, onProgress?: ProgressReporter): GenerateTask => {
    if (typeof Worker === 'undefined') return synchronousTask(request, onProgress);
    activeTask?.cancel();
    const worker = ensureWorker();
    const nextTaskId = ++taskId;
    if (persistentSource !== request.src) {
      persistentSource = request.src;
      sourceId += 1;
      if (isSharedSource(request.src)) {
        worker.postMessage({ type: 'source', sourceId, src: request.src } satisfies WorkerRequest);
      } else {
        const workerData = new Uint8ClampedArray(request.src.data);
        worker.postMessage({ type: 'source', sourceId, src: { ...request.src, data: workerData } } satisfies WorkerRequest, [workerData.buffer]);
      }
    }
    const currentSourceId = sourceId;
    const cancelView = createCancelView();
    let resolvePromise: (output: EngineOutput) => void = () => undefined;
    let rejectPromise: (error: Error) => void = () => undefined;
    const promise = new Promise<EngineOutput>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    const task: ActiveWorkerTask = {
      taskId: nextTaskId, settled: false, cancelView, onProgress,
      resolve: resolvePromise, reject: rejectPromise,
      cancel: () => {
        if (task.settled) return;
        task.settled = true;
        if (activeTask === task) activeTask = null;
        if (task.cancelView) Atomics.store(task.cancelView, 0, 1);
        try {
          if (!task.cancelView) worker.postMessage({ type: 'cancel', taskId: task.taskId } satisfies WorkerRequest);
        } finally {
          task.reject(abortError());
          if (!task.cancelView) terminate();
        }
      },
    };
    activeTask = task;
    worker.postMessage({ type: 'generate', taskId: nextTaskId, sourceId: currentSourceId,
      params: request.params, palette: request.palette,
      cancelBuffer: cancelView?.buffer as SharedArrayBuffer | undefined } satisfies WorkerRequest);
    return { promise, cancel: task.cancel };
  };
  return { run, dispose: () => { activeTask?.cancel(); activeTask = null; terminate(); } };
}

const defaultClient = createGenerateWorkerClient();
export function runGenerate(request: GenerateRequest, onProgress?: ProgressReporter): GenerateTask {
  return defaultClient.run(request, onProgress);
}
export function disposeGenerateWorker(): void { defaultClient.dispose(); }
