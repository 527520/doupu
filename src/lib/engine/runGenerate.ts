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

let persistentWorker: Worker | null = null;
let persistentSource: ImageDataLike | null = null;
let sourceId = 0;
let taskId = 0;
let activeTask: ActiveWorkerTask | null = null;

const abortError = (): Error => {
  const error = new Error('生成任务已取消');
  error.name = 'AbortError';
  return error;
};

function terminatePersistentWorker(): void {
  persistentWorker?.terminate();
  persistentWorker = null;
  persistentSource = null;
  sourceId += 1;
}

function rejectActive(error: Error): void {
  const task = activeTask;
  if (!task || task.settled) return;
  task.settled = true;
  activeTask = null;
  task.reject(error);
}

function ensureWorker(): Worker {
  if (persistentWorker) return persistentWorker;
  const worker = new Worker(new URL('./generate.worker.ts', import.meta.url));
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const task = activeTask;
    if (!task || task.settled || task.taskId !== message.taskId) return;
    if (message.type === 'progress') {
      task.onProgress?.(message.percent);
      return;
    }
    task.settled = true;
    activeTask = null;
    if (message.type === 'done') task.resolve(message.output);
    else if (message.type === 'cancelled') task.reject(abortError());
    else task.reject(new Error(message.error));
  };
  worker.onerror = (event) => {
    rejectActive(new Error(event.message || 'worker 生成失败'));
    terminatePersistentWorker();
  };
  persistentWorker = worker;
  return worker;
}

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

export function runGenerate(request: GenerateRequest, onProgress?: ProgressReporter): GenerateTask {
  if (typeof Worker === 'undefined') return synchronousTask(request, onProgress);

  // The module owns exactly one latest task. Starting a replacement always
  // aborts the previous promise before any new messages can be observed.
  activeTask?.cancel();
  const worker = ensureWorker();
  const nextTaskId = ++taskId;
  if (persistentSource !== request.src) {
    persistentSource = request.src;
    sourceId += 1;
    if (isSharedSource(request.src)) {
      // Shared source is immutable after crop: structured clone carries only
      // the SAB handle and retains exactly one RGBA allocation.
      worker.postMessage({ type: 'source', sourceId, src: request.src } satisfies WorkerRequest);
    } else {
      // Compatibility path: transfer one independent copy so the session can
      // still recreate a Worker after a crash without a detached source.
      const workerData = new Uint8ClampedArray(request.src.data);
      const workerSource = { ...request.src, data: workerData };
      worker.postMessage(
        { type: 'source', sourceId, src: workerSource } satisfies WorkerRequest,
        [workerData.buffer],
      );
    }
  }
  const currentSourceId = sourceId;
  const cancelView = createCancelView();
  let resolvePromise: (output: EngineOutput) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<EngineOutput>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const task: ActiveWorkerTask = {
    taskId: nextTaskId,
    settled: false,
    cancelView,
    onProgress,
    resolve: resolvePromise,
    reject: rejectPromise,
    cancel: () => {
      if (task.settled) return;
      task.settled = true;
      if (activeTask === task) activeTask = null;
      if (task.cancelView) Atomics.store(task.cancelView, 0, 1);
      try {
        // A busy worker observes the shared atomic flag synchronously. Posting a
        // second cancel event would only run after generation unwinds and leave
        // a stale task id in its cancellation set forever.
        if (!task.cancelView) {
          worker.postMessage({ type: 'cancel', taskId: task.taskId } satisfies WorkerRequest);
        }
      } finally {
        task.reject(abortError());
        // Without a shared atomic flag, a busy worker cannot receive the
        // cancel message until computation ends; termination is the only true
        // cancellation fallback. The next request creates and re-initializes it.
        if (!task.cancelView) terminatePersistentWorker();
      }
    },
  };
  activeTask = task;
  worker.postMessage({
    type: 'generate',
    taskId: nextTaskId,
    sourceId: currentSourceId,
    params: request.params,
    palette: request.palette,
    cancelBuffer: cancelView?.buffer as SharedArrayBuffer | undefined,
  } satisfies WorkerRequest);
  return { promise, cancel: task.cancel };
}

/** Explicit lifecycle seam for tests and future app-level disposal. */
export function disposeGenerateWorker(): void {
  activeTask?.cancel();
  activeTask = null;
  terminatePersistentWorker();
}
