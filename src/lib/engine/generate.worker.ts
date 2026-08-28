/** Persistent worker protocol: source is cached once; only task parameters repeat. */
import { generatePattern } from './generate';
import { clearLutCache } from './lut';
import type { ImageDataLike } from './types';
import type { WorkerRequest, WorkerResponse } from './runGenerate';

let source: ImageDataLike | null = null;
let currentSourceId = 0;
const cancelledTasks = new Set<number>();
/** 已取消任务 id 的保留上限（A-17：只发 cancel 而无对应任务时不会被清理）。 */
const CANCELLED_TASK_MEMORY = 64;

/**
 * 空闲释放匹配表（A-09）：生成结束后进入修补/导出阶段往往持续数分钟，
 * 期间 32 MiB 的精确表毫无用处。60 秒无新任务就归零，下次生成再重建。
 */
const LUT_IDLE_RELEASE_MS = 60_000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function cancelIdleRelease(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdleRelease(): void {
  cancelIdleRelease();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    clearLutCache();
  }, LUT_IDLE_RELEASE_MS);
}

function rememberCancelled(taskId: number): void {
  cancelledTasks.add(taskId);
  while (cancelledTasks.size > CANCELLED_TASK_MEMORY) {
    const oldest = cancelledTasks.values().next().value as number | undefined;
    if (oldest === undefined) break;
    cancelledTasks.delete(oldest);
  }
}

const post = (message: WorkerResponse): void => {
  (self as unknown as Worker).postMessage(message);
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'source') {
    source = request.src;
    currentSourceId = request.sourceId;
    return;
  }
  if (request.type === 'cancel') {
    rememberCancelled(request.taskId);
    return;
  }

  const { taskId } = request;
  cancelIdleRelease();
  if (!source || request.sourceId !== currentSourceId) {
    post({ type: 'error', taskId, error: 'generation source is unavailable' });
    return;
  }
  const cancelView = request.cancelBuffer ? new Int32Array(request.cancelBuffer) : null;
  const shouldCancel = (): boolean =>
    cancelledTasks.has(taskId) || (cancelView !== null && Atomics.load(cancelView, 0) === 1);
  try {
    const output = generatePattern(source, request.params, request.palette, (percent) => {
      if (!shouldCancel()) post({ type: 'progress', taskId, percent });
    }, shouldCancel);
    if (shouldCancel()) post({ type: 'cancelled', taskId });
    else post({ type: 'done', taskId, output });
  } catch (error) {
    if (shouldCancel() || (error instanceof Error && error.name === 'AbortError')) {
      post({ type: 'cancelled', taskId });
    } else {
      post({ type: 'error', taskId, error: error instanceof Error ? error.message : '生成失败' });
    }
  } finally {
    cancelledTasks.delete(taskId);
    scheduleIdleRelease();
  }
};
