/**
 * 测试全局设置：jsdom 不支持 Canvas 2D，用 Proxy 桩替代，
 * 使组件测试中的 drawImage/fillRect 等调用静默成功（像素断言在 E2E 覆盖）。
 */
const noop = (): void => undefined;

type AnyObject = Record<string | symbol, unknown>;

function createCtxStub(): AnyObject {
  return new Proxy({} as AnyObject, {
    get(_target, prop) {
      if (prop === 'canvas') return undefined;
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop === 'getImageData' || prop === 'createImageData') {
        return () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
      }
      return noop;
    },
    set() {
      return true;
    },
  });
}

if (typeof HTMLCanvasElement !== 'undefined') {
  // 覆盖 jsdom 抛 "Not implemented" 的 getContext（2d 返回无操作桩）
  const getContextStub = function getContext(this: HTMLCanvasElement, contextId: string) {
    return contextId === '2d'
      ? (createCtxStub() as unknown as CanvasRenderingContext2D)
      : null;
  };
  HTMLCanvasElement.prototype.getContext =
    getContextStub as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
