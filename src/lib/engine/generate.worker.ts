/** Persistent worker protocol: source is cached once; only task parameters repeat. */
import { generatePattern } from './generate';
import type { ImageDataLike } from './types';
import type { WorkerRequest, WorkerResponse } from './runGenerate';

let source: ImageDataLike | null = null;
let currentSourceId = 0;
const cancelledTasks = new Set<number>();

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
    cancelledTasks.add(request.taskId);
    return;
  }

  const { taskId } = request;
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
  }
};
