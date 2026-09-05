// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canDecodeHeicNatively,
  convertHeicWithWasm,
  createImageDecoder,
  decodeImageFile,
  decodeImageRegion,
  type ImageDecodeWorkerRequest,
  type ImageDecodeWorkerResponse,
} from './decode';
import type { DecodedImage } from './decode';

/** heic2any 可控替身（decode.ts 动态 import，vi.mock 工厂可拦截）。 */
const mockHeic2any = vi.fn();
vi.mock('heic2any', () => ({ default: mockHeic2any }));

/** 假位图（jsdom 无 createImageBitmap：桩实现返回的 ImageBitmap 结构）。 */
interface FakeBitmap {
  width: number;
  height: number;
  close: () => void;
}

function stubCreateImageBitmap(
  behavior: 'ok' | 'fail-first' | 'fail-always' | ((blob: Blob, opts?: ImageBitmapOptions) => Promise<FakeBitmap>),
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (blob: Blob, opts?: ImageBitmapOptions): Promise<FakeBitmap> => {
    if (behavior === 'ok') return { width: 4, height: 3, close: () => undefined };
    if (behavior === 'fail-first') {
      if (opts) throw new DOMException('unsupported option', 'NotSupportedError');
      return { width: 4, height: 3, close: () => undefined };
    }
    if (behavior === 'fail-always') throw new DOMException('decode failed', 'EncodingError');
    return behavior(blob, opts);
  });
  vi.stubGlobal('createImageBitmap', fn);
  return fn;
}

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const largePngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0x0f, 0xa0, // 4000
  0, 0, 0x07, 0xd0, // 2000
]);

class FakeDecodeWorker {
  onmessage: ((event: MessageEvent<ImageDecodeWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: ImageDecodeWorkerRequest[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  failNativeHeic = false;

  postMessage(request: ImageDecodeWorkerRequest, transfer: Transferable[] = []): void {
    this.posted.push(request);
    this.transfers.push(transfer);
    if (request.type === 'probe') {
      this.emit({ type: 'ready', requestId: request.requestId });
    } else if (request.type === 'load') {
      if (request.imageType === 'heic' && this.failNativeHeic) {
        this.emit({
          type: 'result',
          requestId: request.requestId,
          result: { ok: false, code: 'HEIC_UNSUPPORTED' },
          recoveredBytes: request.bytes,
        });
        return;
      }
      this.emit({
        type: 'result',
        requestId: request.requestId,
        result: {
          ok: true,
          image: {
            data: new Uint8ClampedArray(4),
            width: 1,
            height: 1,
            naturalWidth: 4000,
            naturalHeight: 2000,
            mime: 'image/png',
          },
        },
      });
    } else if (request.type === 'region') {
      this.emit({
        type: 'result',
        requestId: request.requestId,
        result: {
          ok: true,
          image: { data: new Uint8ClampedArray(4), width: 1, height: 1, mime: 'image/png' },
        },
      });
    }
  }

  terminate(): void { this.terminated = true; }
  emit(response: ImageDecodeWorkerResponse): void {
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<ImageDecodeWorkerResponse>));
  }
}

describe('ImageDecoder 持久 Worker 接口', () => {
  it('clear 丢弃迟到的解码结果并关闭已经创建的 bitmap', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('OffscreenCanvas', undefined);
    let finish!: (bitmap: FakeBitmap) => void;
    const create = stubCreateImageBitmap(() => new Promise((resolve) => { finish = resolve; }));
    const decoder = createImageDecoder();
    const loading = decoder.load(pngBytes.slice(), 'png');
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    decoder.clear();
    const close = vi.fn();
    finish({ width: 4, height: 3, close });
    await expect(loading).resolves.toMatchObject({ ok: false });
    expect(close).toHaveBeenCalledOnce();
    await expect(decoder.region({ x: 0, y: 0, width: 2, height: 2 }, 800)).resolves.toMatchObject({ ok: false });
  });
  it.each(['clear', 'dispose'] as const)('%s 使尚未开始的解码失效，不能重新保留原图', async (action) => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('OffscreenCanvas', undefined);
    const bitmap = stubCreateImageBitmap('ok');
    const decoder = createImageDecoder();
    const loading = decoder.load(pngBytes.slice(), 'png');
    decoder[action]();
    await expect(loading).resolves.toMatchObject({ ok: false });
    await expect(decoder.region({ x: 0, y: 0, width: 2, height: 2 }, 800)).resolves.toMatchObject({ ok: false });
    expect(bitmap).not.toHaveBeenCalled();
    // StrictMode 清理后，同一实例仍可为下一次会话工作。
    await expect(decoder.load(pngBytes.slice(), 'png')).resolves.toMatchObject({ ok: true });
    decoder.dispose();
  });

  it('压缩源只传输一次，后续区域解码只发送坐标', async () => {
    const workers: FakeDecodeWorker[] = [];
    vi.stubGlobal('Worker', class extends FakeDecodeWorker {
      constructor() {
        super();
        workers.push(this);
      }
    });
    vi.stubGlobal('OffscreenCanvas', class {});
    stubCreateImageBitmap('ok');
    const decoder = createImageDecoder();
    const bytes = largePngBytes.slice();

    await expect(decoder.load(bytes, 'png')).resolves.toMatchObject({ ok: true });
    await expect(decoder.region({ x: 10, y: 20, width: 30, height: 40 }, 800))
      .resolves.toMatchObject({ ok: true });

    expect(workers).toHaveLength(1);
    expect(workers[0].posted.map((request) => request.type)).toEqual(['probe', 'load', 'region']);
    expect(workers[0].transfers[1]).toHaveLength(1);
    expect(workers[0].posted[2]).not.toHaveProperty('bytes');
    decoder.dispose();
    expect(workers[0].terminated).toBe(true);
  });

  it('HEIC 原生探针在 Worker 内完成，失败后回传源数据给 WASM 再加载 JPEG', async () => {
    const workers: FakeDecodeWorker[] = [];
    vi.stubGlobal('Worker', class extends FakeDecodeWorker {
      constructor() {
        super();
        this.failNativeHeic = true;
        workers.push(this);
      }
    });
    vi.stubGlobal('OffscreenCanvas', class {});
    const mainThreadBitmap = stubCreateImageBitmap('ok');
    mockHeic2any.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }));
    const onFallback = vi.fn();

    const result = await createImageDecoder().load(new Uint8Array([1, 2, 3]), 'heic', onFallback);

    expect(result).toMatchObject({ ok: true });
    expect(mainThreadBitmap).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledOnce();
    expect(mockHeic2any).toHaveBeenCalledOnce();
    expect(workers[0].posted.filter((request) => request.type === 'load').map((request) => (
      request.type === 'load' ? request.imageType : null
    ))).toEqual(['heic', 'jpeg']);
  });

  it('无 Worker/OffscreenCanvas 时保留主线程有界功能降级', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('OffscreenCanvas', undefined);
    stubCreateImageBitmap('ok');
    const decoder = createImageDecoder();

    await expect(decoder.load(pngBytes.slice(), 'png')).resolves.toMatchObject({ ok: true });
    await expect(decoder.region({ x: 0, y: 0, width: 2, height: 2 }, 2))
      .resolves.toMatchObject({ ok: true, image: { width: 2, height: 2 } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('decodeImageFile（jsdom 桩）', () => {
  it('成功路径：返回 RGBA 像素与尺寸，mime 正确，bitmap 关闭', async () => {
    stubCreateImageBitmap('ok');
    const result = await decodeImageFile(pngBytes, 'png');
    expect(result.ok).toBe(true);
    const image = (result as { image: DecodedImage }).image;
    expect(image.width).toBe(4);
    expect(image.height).toBe(3);
    expect(image.mime).toBe('image/png');
    expect(image.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it('WebKit 降级：带 imageOrientation 抛错后，以不带选项重试成功', async () => {
    const fn = stubCreateImageBitmap('fail-first');
    const result = await decodeImageFile(pngBytes, 'png');
    expect(result.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('大图请求解码器直接缩到 512px 预览，同时保留头部自然尺寸', async () => {
    const fn = stubCreateImageBitmap(async (_blob, opts) => ({
      width: opts?.resizeWidth ?? 4000,
      height: opts?.resizeHeight ?? 2000,
      close: vi.fn(),
    }));
    const result = await decodeImageFile(largePngBytes, 'png');
    expect(result).toMatchObject({
      ok: true,
      image: { width: 512, height: 256, naturalWidth: 4000, naturalHeight: 2000 },
    });
    expect(fn).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({
      imageOrientation: 'from-image', resizeWidth: 512, resizeHeight: 256, resizeQuality: 'high',
    }));
  });

  it('两次解码都失败：png → DECODE_FAILED，heic → HEIC_UNSUPPORTED', async () => {
    stubCreateImageBitmap('fail-always');
    expect(await decodeImageFile(pngBytes, 'png')).toEqual({ ok: false, code: 'DECODE_FAILED' });
    expect(await decodeImageFile(pngBytes, 'heic')).toEqual({ ok: false, code: 'HEIC_UNSUPPORTED' });
  });

  it('2d 上下文不可用 → DECODE_FAILED', async () => {
    const close = vi.fn();
    stubCreateImageBitmap(async () => ({ width: 4, height: 3, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(await decodeImageFile(pngBytes, 'png')).toEqual({ ok: false, code: 'DECODE_FAILED' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('drawImage 抛错 → DECODE_FAILED（且 close 兜底不抛）', async () => {
    stubCreateImageBitmap('ok');
    const badCtx = new Proxy({} as Record<string, unknown>, {
      get(target, prop) {
        if (prop === 'drawImage') return () => { throw new Error('draw boom'); };
        if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
        return target[prop as string];
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      badCtx as unknown as CanvasRenderingContext2D,
    );
    expect(await decodeImageFile(pngBytes, 'png')).toEqual({ ok: false, code: 'DECODE_FAILED' });
  });
});

describe('decodeImageRegion', () => {
  it('在已按 EXIF 定向的 bitmap 上使用预览自然坐标裁剪，并输出有界 RGBA', async () => {
    const close = vi.fn();
    const bitmap = { width: 4000, height: 2000, close };
    const create = vi.fn(async () => bitmap);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal('createImageBitmap', create);

    const result = await decodeImageRegion(
      pngBytes,
      'jpeg',
      { x: 100, y: 200, width: 4000, height: 2000 },
      1200,
    );

    expect(result).toMatchObject({ ok: true, image: { width: 1200, height: 600 } });
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'from-image' });
    expect(drawImage).toHaveBeenCalledWith(bitmap, 100, 200, 4000, 2000, 0, 0, 1200, 600);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('PNG 选区让解码器直接裁剪并缩放，不先物化全尺寸 oriented bitmap', async () => {
    const close = vi.fn();
    const create = vi.fn(async () => ({ width: 800, height: 400, close }));
    const drawImage = vi.fn();
    vi.stubGlobal('createImageBitmap', create);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    } as unknown as CanvasRenderingContext2D);

    await expect(decodeImageRegion(
      largePngBytes,
      'png',
      { x: 100, y: 200, width: 4000, height: 2000 },
      800,
    )).resolves.toMatchObject({ ok: true, image: { width: 800, height: 400 } });
    expect(create).toHaveBeenCalledWith(
      expect.any(Blob), 100, 200, 4000, 2000,
      { resizeWidth: 800, resizeHeight: 400, resizeQuality: 'high' },
    );
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 400);
    expect(close).toHaveBeenCalledOnce();
  });

  it('WebKit 不支持 imageOrientation 选项时降级解码，仍只保留一份 bitmap 和有界 canvas', async () => {
    const close = vi.fn();
    const create = vi.fn(async (...args: unknown[]) => {
      if (args.length === 2) throw new DOMException('unsupported option', 'NotSupportedError');
      return { width: 4000, height: 2000, close };
    });
    vi.stubGlobal('createImageBitmap', create);

    const result = await decodeImageRegion(
      pngBytes,
      'jpeg',
      { x: 0, y: 0, width: 4000, height: 2000 },
      1200,
    );

    expect(result).toMatchObject({ ok: true, image: { width: 1200, height: 600 } });
    expect(create).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('有界 canvas 不可用时返回失败并关闭 oriented bitmap', async () => {
    const close = vi.fn();
    stubCreateImageBitmap(async () => ({ width: 4000, height: 2000, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await expect(decodeImageRegion(
      pngBytes,
      'png',
      { x: 100, y: 200, width: 4000, height: 2000 },
      1200,
    )).resolves.toEqual({ ok: false, code: 'DECODE_FAILED' });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('canDecodeHeicNatively', () => {
  it('createImageBitmap 成功 → true；抛错 → false', async () => {
    const close = vi.fn();
    stubCreateImageBitmap(async () => ({ width: 1, height: 1, close }));
    await expect(canDecodeHeicNatively(new Uint8Array([9]))).resolves.toBe(true);
    expect(close).toHaveBeenCalledTimes(1);

    stubCreateImageBitmap('fail-always');
    await expect(canDecodeHeicNatively(new Uint8Array([9]))).resolves.toBe(false);
  });

  it('用调用方提供的完整 HEIC 文件做原生解码探测，不使用截断头', async () => {
    const input = new Uint8Array([1, 2, 3, 4]);
    stubCreateImageBitmap(async (blob) => {
      expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([...input]);
      return { width: 1, height: 1, close: vi.fn() };
    });
    await expect(canDecodeHeicNatively(input)).resolves.toBe(true);
  });
});

describe('convertHeicWithWasm', () => {
  const heicBlob = { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };

  beforeEach(() => {
    mockHeic2any.mockReset();
  });

  it('单结果：返回转换后的字节', async () => {
    mockHeic2any.mockResolvedValue(heicBlob);
    const bytes = await convertHeicWithWasm(new Uint8Array([9, 9]));
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it('多结果数组：取第一个', async () => {
    mockHeic2any.mockResolvedValue([heicBlob, { arrayBuffer: async () => new ArrayBuffer(0) }]);
    const bytes = await convertHeicWithWasm(new Uint8Array([9, 9]));
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it('无输出：抛错', async () => {
    mockHeic2any.mockResolvedValue([]);
    await expect(convertHeicWithWasm(new Uint8Array([9, 9]))).rejects.toThrow('HEIC 转换无输出');
  });

  it('heic2any 本身抛错：向上传播', async () => {
    mockHeic2any.mockRejectedValue(new Error('wasm boom'));
    await expect(convertHeicWithWasm(new Uint8Array([9, 9]))).rejects.toThrow('wasm boom');
  });
});
