import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { generateBatchItem } from './batchGeneration';
import { zhCN } from '@/messages/zh-CN';

const mocks = vi.hoisted(() => ({ load: vi.fn(), region: vi.fn(), clear: vi.fn(), decodeDispose: vi.fn(), run: vi.fn(), generateDispose: vi.fn(), sniff: vi.fn() }));
vi.mock('@/lib/image/decode', () => ({ createImageDecoder: () => ({ load: mocks.load, region: mocks.region, clear: mocks.clear, dispose: mocks.decodeDispose }) }));
vi.mock('@/lib/image/sniff', () => ({ sniffImageType: mocks.sniff }));
vi.mock('@/lib/engine/runGenerate', () => ({ createGenerateWorkerClient: () => ({ run: mocks.run, dispose: mocks.generateDispose }) }));
const pattern = { width: 1, height: 1, cells: [{ hex: '#FFFFFF', code: 'A01', transparent: false }] };
const image = { width: 10, height: 10, data: new Uint8ClampedArray(400), naturalWidth: 100, naturalHeight: 100, mime: 'image/png' };
const source = () => ({ arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)) }) as unknown as File;
beforeEach(() => {
  vi.clearAllMocks(); mocks.sniff.mockReturnValue('png');
  mocks.load.mockResolvedValue({ ok: true, image }); mocks.region.mockResolvedValue({ ok: true, image });
  mocks.run.mockReturnValue({ promise: Promise.resolve({ pattern }), cancel: vi.fn() });
});
it('passes natural-coordinate crop and disposes both clients before exposing the result', async () => {
  const crop = { x: 10, y: 20, width: 40, height: 50 };
  const task = generateBatchItem({ file: source(), crop, params: DEFAULT_GENERATION_PARAMS }, vi.fn());
  const result = await task.promise;
  expect(result.pattern).toEqual(pattern); expect(mocks.region.mock.calls[0][0]).toEqual(crop);
  expect(mocks.decodeDispose).toHaveBeenCalledTimes(1); expect(mocks.generateDispose).toHaveBeenCalledTimes(1);
  expect(result).not.toHaveProperty('file'); expect(result).not.toHaveProperty('crop');
});
it('cancels during file read without loading image bytes into a decoder', async () => {
  let read!: (bytes: ArrayBuffer) => void;
  const file = { arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => { read = resolve; }) } as unknown as File;
  const task = generateBatchItem({ file, crop: null, params: DEFAULT_GENERATION_PARAMS }, vi.fn());
  task.cancel(); read(new ArrayBuffer(10));
  await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' });
  expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.generateDispose).toHaveBeenCalled();
});
it('cancels while decoding and ignores a late decoder result', async () => {
  let decoded!: (value: unknown) => void;
  mocks.load.mockImplementation(() => new Promise((resolve) => { decoded = resolve; }));
  const task = generateBatchItem({ file: source(), crop: null, params: DEFAULT_GENERATION_PARAMS }, vi.fn());
  await vi.waitFor(() => expect(mocks.load).toHaveBeenCalled()); task.cancel(); decoded({ ok: true, image });
  await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' }); expect(mocks.region).not.toHaveBeenCalled();
});
it.each(['unknown', 'oversize', 'region-error'])('cleans up a rejected %s image', async (failure) => {
  if (failure === 'unknown') mocks.sniff.mockReturnValue('unknown');
  if (failure === 'oversize') mocks.load.mockResolvedValue({ ok: true, image: { ...image, naturalWidth: 10000, naturalHeight: 10000 } });
  if (failure === 'region-error') mocks.region.mockResolvedValue({ ok: false, code: 'DECODE_FAILED' });
  await expect(generateBatchItem({ file: source(), crop: null, params: DEFAULT_GENERATION_PARAMS }, vi.fn()).promise).rejects.toBeInstanceOf(Error);
  expect(mocks.decodeDispose).toHaveBeenCalled(); expect(mocks.generateDispose).toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});

it.each(['DECODE_FAILED', 'HEIC_UNSUPPORTED'] as const)('translates decoder error %s before it reaches the batch UI', async (code) => {
  mocks.load.mockResolvedValue({ ok: false, code });
  await expect(generateBatchItem({ file: source(), crop: null, params: DEFAULT_GENERATION_PARAMS }, vi.fn()).promise).rejects.toThrow(zhCN.errors[code]);
});
it('explains the pixel limit in the same language as the workbench', async () => {
  mocks.load.mockResolvedValue({ ok: true, image: { ...image, naturalWidth: 10000, naturalHeight: 10000 } });
  await expect(generateBatchItem({ file: source(), crop: null, params: DEFAULT_GENERATION_PARAMS }, vi.fn()).promise).rejects.toThrow(zhCN.errors.TOO_MANY_PIXELS);
});
