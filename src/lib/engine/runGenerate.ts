/**
 * 生成任务运行器（优化票 07）：
 * - 浏览器：Web Worker 中执行 generatePattern（不冻结页面），返回可取消的 GenerateTask；
 * - 无 Worker 环境（jsdom 单测/降级）：同步执行；
 * - 失败回退：Worker 异常（脚本错误/执行错误）→ 主线程同步执行一次保底，并 console.error 记录。
 * 取消语义：cancel() 立即以 AbortError 拒绝 promise、UI 恢复可交互；
 * Worker **不**强制终止——Firefox 对 webpack 模块 worker 在任务执行中调用 terminate()
 * 会直接崩溃页面（E2E 实测复现），因此改为「丢弃语义」：Worker 自然跑完后在 done/error
 * 处理器中销毁自己，迟到结果由调用方 token 丢弃。调用方另持 token 防旧结果覆盖新结果。
 */
import { generatePattern, type ProgressReporter } from './generate';
import { type EngineOutput, type ImageDataLike } from './types';
import type { GenerationParams, PaletteColor } from '@/lib/types';

export interface GenerateRequest {
  src: ImageDataLike;
  params: GenerationParams;
  palette: PaletteColor[];
}

/** Worker → 主线程消息协议。 */
export type WorkerResponse =
  | { type: 'progress'; percent: number }
  | { type: 'done'; output: EngineOutput }
  | { type: 'error'; error: string };

export interface GenerateTask {
  promise: Promise<EngineOutput>;
  /** 取消在途任务：promise 立即以 AbortError 拒绝；Worker 自然跑完后自行销毁（结果被丢弃）。 */
  cancel: () => void;
}

export function runGenerate(
  request: GenerateRequest,
  onProgress?: ProgressReporter,
): GenerateTask {
  if (typeof Worker === 'undefined') {
    // jsdom 单测与极老浏览器：同步回退（无法抢占；结果由调用方 token 丢弃）
    return {
      promise: new Promise<EngineOutput>((resolve, reject) => {
        try {
          resolve(generatePattern(request.src, request.params, request.palette, onProgress));
        } catch (error) {
          reject(error instanceof Error ? error : new Error('生成失败'));
        }
      }),
      cancel: () => {
        // 同步路径不可抢占：保持 no-op（调用方 token 已作废结果）
      },
    };
  }

  const holder: { current: Worker | null } = { current: new Worker(new URL('./generate.worker.ts', import.meta.url)) };
  let rejectPromise: ((reason: Error) => void) | null = null;
  let settled = false;

  const promise = new Promise<EngineOutput>((resolve, reject) => {
    rejectPromise = reject;
    const w = holder.current;
    if (!w) {
      reject(new Error('worker 不可用'));
      return;
    }
    const settleResolve = (output: EngineOutput): void => {
      if (settled) return;
      settled = true;
      resolve(output);
    };
    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    /** Worker 异常 → 主线程同步执行一次保底（优化票 07 要求 4），并记录日志。 */
    const fallbackToMainThread = (reason: string): void => {
      holder.current = null;
      console.error(`[runGenerate] ${reason}，回退主线程同步执行`);
      try {
        settleResolve(generatePattern(request.src, request.params, request.palette, onProgress));
      } catch (error) {
        settleReject(error instanceof Error ? error : new Error('生成失败'));
      }
    };

    w.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.(data.percent);
        return;
      }
      // done/error 消息本身就是任务结束信号：此刻 terminate 是安全的
      // （Firefox 仅在任务执行中 terminate 会崩溃）
      w.terminate();
      holder.current = null;
      if (data.type === 'done') settleResolve(data.output);
      else fallbackToMainThread(`worker 执行失败：${data.error}`);
    };
    w.onerror = (event) => {
      // 不 terminate：Worker 脚本级错误后其任务已停止；规避 Firefox 模块 worker terminate 崩溃风险
      holder.current = null;
      fallbackToMainThread(`worker 错误：${event.message || '未知错误'}`);
    };
    w.postMessage(request);
  });

  return {
    promise,
    cancel: () => {
      if (!holder.current) return; // 已结束或已取消
      holder.current = null; // 断开引用：Worker 自然跑完后自行销毁，迟到结果被 settle 守卫丢弃
      const error = new Error('生成任务已取消');
      error.name = 'AbortError';
      rejectPromise?.(error);
    },
  };
}
