/**
 * 生成 Web Worker（优化票 07）：把 generatePattern 移到后台线程，页面不冻结。
 * 协议：接收 GenerateRequest；按阶段回发 { type:'progress', percent }（0→100 单调）；
 * 成功回发 { type:'done', output }；异常回发 { type:'error', error }。
 */
import { generatePattern } from './generate';
import type { GenerateRequest, WorkerResponse } from './runGenerate';

const post = (message: WorkerResponse): void => {
  (self as unknown as Worker).postMessage(message);
};

self.onmessage = (event: MessageEvent<GenerateRequest>) => {
  try {
    const { src, params, palette } = event.data;
    const output = generatePattern(src, params, palette, (percent) => {
      post({ type: 'progress', percent });
    });
    post({ type: 'done', output });
  } catch (error) {
    post({
      type: 'error',
      error: error instanceof Error ? error.message : '生成失败',
    });
  }
};
