// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageDecodeWorkerRequest, ImageDecodeWorkerResponse } from './decode';

interface WorkerSelfMock {
  onmessage: ((event: MessageEvent<ImageDecodeWorkerRequest>) => void | Promise<void>) | null;
  postMessage: (message: ImageDecodeWorkerResponse, transfer?: Transferable[]) => void;
}

const largePngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0x0f, 0xa0,
  0, 0, 0x07, 0xd0,
]);

let selfMock: WorkerSelfMock;
let drawImage: ReturnType<typeof vi.fn>;
let bitmapClose: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  selfMock = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal('self', selfMock);
  drawImage = vi.fn();
  bitmapClose = vi.fn();
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(readonly width: number, readonly height: number) {}
    getContext() {
      return {
        drawImage,
        getImageData: () => ({
          data: new Uint8ClampedArray(this.width * this.height * 4),
          width: this.width,
          height: this.height,
        }),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
      };
    }
  });
  vi.stubGlobal('createImageBitmap', vi.fn(async (...args: unknown[]) => {
    const options = args.at(-1) as { resizeWidth?: number; resizeHeight?: number } | undefined;
    return {
      width: options?.resizeWidth ?? 4000,
      height: options?.resizeHeight ?? 2000,
      close: bitmapClose,
    };
  }));
  await import('./decode.worker');
});

afterEach(() => vi.unstubAllGlobals());

const dispatch = async (request: ImageDecodeWorkerRequest): Promise<void> => {
  await selfMock.onmessage?.({ data: request } as MessageEvent<ImageDecodeWorkerRequest>);
};

describe('decode.worker 持久源协议', () => {
  it('load 生成有界预览，region 复用已缓存压缩源并传回 RGBA', async () => {
    await dispatch({ type: 'probe', requestId: 1 });
    await dispatch({ type: 'load', requestId: 2, sourceId: 7, bytes: largePngBytes, imageType: 'png' });
    await dispatch({
      type: 'region',
      requestId: 3,
      sourceId: 7,
      rect: { x: 10, y: 20, width: 4000, height: 2000 },
      maxDimension: 800,
    });

    const calls = vi.mocked(selfMock.postMessage).mock.calls;
    expect(calls[0][0]).toEqual({ type: 'ready', requestId: 1 });
    expect(calls[1][0]).toMatchObject({
      type: 'result', requestId: 2,
      result: { ok: true, image: { width: 512, height: 256, naturalWidth: 4000, naturalHeight: 2000 } },
    });
    expect(calls[2][0]).toMatchObject({
      type: 'result', requestId: 3,
      result: { ok: true, image: { width: 800, height: 400 } },
    });
    expect(calls[2][1]).toHaveLength(1);
    expect(bitmapClose).toHaveBeenCalledTimes(2);
  });

  it('原生 HEIC 解码失败时释放缓存并把压缩源所有权转回调用方', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new DOMException('unsupported HEIC', 'EncodingError');
    }));
    const heicBytes = new Uint8Array([1, 2, 3, 4]);

    await dispatch({ type: 'load', requestId: 4, sourceId: 9, bytes: heicBytes, imageType: 'heic' });
    await dispatch({
      type: 'region',
      requestId: 5,
      sourceId: 9,
      rect: { x: 0, y: 0, width: 1, height: 1 },
      maxDimension: 1,
    });

    const calls = vi.mocked(selfMock.postMessage).mock.calls;
    expect(calls[0][0]).toMatchObject({
      type: 'result',
      requestId: 4,
      result: { ok: false, code: 'HEIC_UNSUPPORTED' },
      recoveredBytes: heicBytes,
    });
    expect(calls[0][1]).toEqual([heicBytes.buffer]);
    expect(calls[1][0]).toMatchObject({
      type: 'result', requestId: 5, result: { ok: false, code: 'DECODE_FAILED' },
    });
  });
});
