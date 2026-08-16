// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canDecodeHeicNatively,
  convertHeicWithWasm,
  decodeImageFile,
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

  it('两次解码都失败：png → DECODE_FAILED，heic → HEIC_UNSUPPORTED', async () => {
    stubCreateImageBitmap('fail-always');
    expect(await decodeImageFile(pngBytes, 'png')).toEqual({ ok: false, code: 'DECODE_FAILED' });
    expect(await decodeImageFile(pngBytes, 'heic')).toEqual({ ok: false, code: 'HEIC_UNSUPPORTED' });
  });

  it('2d 上下文不可用 → DECODE_FAILED', async () => {
    stubCreateImageBitmap('ok');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(await decodeImageFile(pngBytes, 'png')).toEqual({ ok: false, code: 'DECODE_FAILED' });
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

describe('canDecodeHeicNatively', () => {
  it('createImageBitmap 成功 → true；抛错 → false', async () => {
    stubCreateImageBitmap('ok');
    await expect(canDecodeHeicNatively()).resolves.toBe(true);

    stubCreateImageBitmap('fail-always');
    await expect(canDecodeHeicNatively()).resolves.toBe(false);
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
