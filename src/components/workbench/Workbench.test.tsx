// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Workbench from './Workbench';
import type { StitchProgress } from '@/lib/progress/stitchProgress';
import type { DecodedImage, DecodeResult, ImageDecoder } from '@/lib/image/decode';
import type {
  DesignRecord,
  GenerationSourceWrite,
  LocalGenerationSourceV1,
  StorageAdapter,
} from '@/lib/storage';
import type { ProjectFile } from '@/lib/types';
import { zhCN } from '@/messages/zh-CN';
import { runGenerate, type GenerateTask } from '@/lib/engine/runGenerate';
import type { EngineOutput } from '@/lib/engine/types';
import { resetAuthStatusCache } from '@/components/account/useAuthStatus';

const {
  pushMock,
  enqueueDesignSyncMock,
  enqueueDesignSyncFacadeMock,
  defaultEnqueueDesignSyncMock,
  withDesignStorageLockMock,
  createDoupuApiMock,
  cloudApiStub,
} = vi.hoisted(() => {
  const innerSync = vi.fn(async (): Promise<unknown> => undefined);
  const defaultFacade = async (...args: unknown[]): Promise<unknown> => {
    const outcome = await innerSync();
    const onOutcome = args[2] as ((value: unknown) => void | Promise<void>) | undefined;
    if (outcome && onOutcome) await onOutcome(outcome);
    // 模拟 enqueueDesignSync：先交付不可逆的冲突/覆盖结果，
    // 再因同批次其他设计失败而拒绝整轮同步。
    const errors = outcome && typeof outcome === 'object'
      ? (outcome as { errors?: unknown }).errors
      : undefined;
    if (Array.isArray(errors) && errors.length > 0) {
      throw new Error('同步未完整完成，请稍后重试');
    }
    return outcome;
  };
  return {
    pushMock: vi.fn(),
    enqueueDesignSyncMock: innerSync,
    enqueueDesignSyncFacadeMock: vi.fn(defaultFacade),
    defaultEnqueueDesignSyncMock: defaultFacade,
    withDesignStorageLockMock: vi.fn((run: () => Promise<unknown>) => run()),
    createDoupuApiMock: vi.fn(),
    cloudApiStub: {},
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('@/lib/sync/api', () => ({
  createDoupuApi: createDoupuApiMock.mockReturnValue(cloudApiStub),
}));
vi.mock('@/lib/sync/queue', () => ({
  enqueueDesignSync: (...args: unknown[]) => enqueueDesignSyncFacadeMock(...args),
  withDesignStorageLock: <T,>(run: () => Promise<T>) => withDesignStorageLockMock(run) as Promise<T>,
}));

/** 内存版存储假实现（测试专用）。 */
class FakeStorage implements StorageAdapter {
  readonly designs = new Map<string, DesignRecord>();
  readonly sources = new Map<string, LocalGenerationSourceV1>();
  sourceReplaceCount = 0;
  quotaExceeded = false;
  async getAll(): Promise<DesignRecord[]> {
    return [...this.designs.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  async getGenerationSource(id: string): Promise<LocalGenerationSourceV1 | null> {
    const source = this.sources.get(id);
    return source ? structuredClone(source) : null;
  }
  async put(record: DesignRecord, sourceWrite: GenerationSourceWrite = { mode: 'preserve' }): Promise<void> {
    if (this.quotaExceeded) throw new DOMException('quota', 'QuotaExceededError');
    this.designs.set(record.id, { ...record });
    if (sourceWrite.mode === 'replace') {
      this.sourceReplaceCount += 1;
      this.sources.set(record.id, structuredClone(sourceWrite.source));
    }
    if (sourceWrite.mode === 'clear') this.sources.delete(record.id);
  }
  async delete(id: string): Promise<void> {
    this.designs.delete(id);
    this.sources.delete(id);
  }
  async getMeta(): Promise<string | null> {
    return null;
  }
  async setMeta(): Promise<void> {
    // no-op
  }
  readonly progress = new Map<string, StitchProgress>();
  async getStitchProgress(designId: string): Promise<StitchProgress | null> {
    const stored = this.progress.get(designId);
    return stored ? { ...stored, done: stored.done.slice(0) } : null;
  }
  async putStitchProgress(designId: string, progress: StitchProgress): Promise<void> {
    if (this.quotaExceeded) throw new DOMException('quota', 'QuotaExceededError');
    this.progress.set(designId, { ...progress, done: progress.done.slice(0) });
  }
  async deleteStitchProgress(designId: string): Promise<void> {
    this.progress.delete(designId);
  }
}

class SerialStitchStorage extends FakeStorage {
  readonly writes: StitchProgress[] = [];
  activeWrites = 0;
  maxActiveWrites = 0;
  private releaseFirstWrite: (() => void) | null = null;

  releaseFirst(): void {
    this.releaseFirstWrite?.();
    this.releaseFirstWrite = null;
  }

  override async putStitchProgress(designId: string, progress: StitchProgress): Promise<void> {
    this.writes.push({ ...progress, done: progress.done.slice(0) });
    this.activeWrites += 1;
    this.maxActiveWrites = Math.max(this.maxActiveWrites, this.activeWrites);
    if (this.writes.length === 1) {
      await new Promise<void>((resolve) => {
        this.releaseFirstWrite = resolve;
      });
    }
    await super.putStitchProgress(designId, progress);
    this.activeWrites -= 1;
  }
}

function fixtureBytes(name: string): Uint8Array {
  const url = new URL('../../../tests/fixtures/' + name, import.meta.url);
  return new Uint8Array(readFileSync(fileURLToPath(url)));
}

function makeFile(): File {
  return new File([fixtureBytes('static.png').slice()], 'photo.png', { type: 'image/png' });
}

/** 8×8 红色不透明图（解码假实现返回）。 */
const fakeImage: DecodedImage = (() => {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 8 * 8; i++) {
    data[i * 4] = 255;
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  return { data, width: 8, height: 8, mime: 'image/png' };
})();

function fakeDecode(_bytes: Uint8Array, _type: unknown): Promise<DecodeResult> {
  void _bytes;
  void _type;
  return Promise.resolve({ ok: true, image: fakeImage });
}

/** UI flow adapter: generation algorithms and their performance are covered by
 * engine oracle/performance projects, so Workbench tests keep only the async
 * task contract and deterministic dimensions. */
const instantGenerate: typeof runGenerate = (request, onProgress): GenerateTask => {
  const width = request.params.targetWidth;
  const height = Math.min(200, Math.max(1, Math.round(
    (width * request.src.height) / request.src.width,
  )));
  // Use a non-default brush color so the editor scenario still performs a
  // real semantic change when it paints with palette[0].
  const color = [...request.palette].reverse().find((entry) => entry.code !== null)!;
  const total = width * height;
  onProgress?.(100);
  return {
    promise: Promise.resolve({
      pattern: {
        width,
        height,
        cells: Array.from({ length: total }, () => ({
          hex: color.hex,
          code: color.code,
          transparent: false,
        })),
      },
      stats: [{ hex: color.hex, code: color.code!, count: total }],
      totalBeadCount: total,
      mergeThresholdUsed: 0,
    }),
    cancel: vi.fn(),
  };
};

function savedProject(name: string, updatedAt: string): ProjectFile {
  return {
    format: 'doupu-project',
    version: 3,
    engineVersion: '2.0.0',
    boardProfile: '5mm-29',
    name,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt,
    paletteSelection: {
      palette: { kind: 'builtin', brand: 'MARD' },
      kitTier: 0,
    },
    params: {
      targetWidth: 100,
      targetColorCount: 40,
      dithering: false,
      mode: 'dominant',
      brightness: 0,
      contrast: 0,
      backgroundRemoval: false,
      bgTolerance: 8,
    },
    pattern: {
      width: 2,
      height: 1,
      cells: [
        { hex: '#000000', code: 'H07', transparent: false },
        { hex: null, code: null, transparent: true },
      ],
    },
  };
}

function record(id: string, project: ProjectFile): DesignRecord {
  return { id, name: project.name, projectJson: JSON.stringify(project), thumbnail: null, updatedAt: project.updatedAt };
}

const selectUploadInput = (): HTMLInputElement => screen.getByLabelText(zhCN.upload.inputLabel) as HTMLInputElement;
const selectPaletteBrand = (): HTMLSelectElement => screen.getByLabelText(zhCN.params.brand) as HTMLSelectElement;
const selectPaletteSeries = (): HTMLSelectElement => screen.getByLabelText(zhCN.params.series) as HTMLSelectElement;
const clickGuestRestart = (): void => {
  fireEvent.click(screen.getByRole('button', { name: zhCN.nav.more }));
  fireEvent.click(within(screen.getByRole('region', { name: zhCN.nav.more }))
    .getByRole('button', { name: zhCN.workbench.restart }));
};

/** 常见准备：预置一个已保存设计并渲染，等待恢复完成（真实计时器阶段）。 */
async function renderRestored(storage: FakeStorage): Promise<HTMLInputElement> {
  storage.designs.set('id-last', record('id-last', savedProject('初始', '2026-08-14T12:00:00.000Z')));
  render(<Workbench storage={storage} />);
  return (await screen.findAllByDisplayValue('初始'))[0] as HTMLInputElement;
}

function mockMobileViewport(): () => void {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(max-width: 720px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
  return () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
  };
}

describe('Workbench 全流程', () => {
  it('色板库返回只在指定设计中提示应用，未确认不改图纸，应用后可一步撤销', async () => {
    const value = 'builtin:pcd:mard-291-github@178dafbc9e77d3de556550dbd058270200129186';
    window.history.replaceState(null, '', `/app?id=chosen&palette=${encodeURIComponent(value)}`);
    const storage = new FakeStorage();
    const original = savedProject('准确的目标设计', '2026-08-14T12:00:00Z');
    storage.designs.set('chosen', record('chosen', original));
    const view = render(<Workbench storage={storage} />);
    try {
      await screen.findByDisplayValue('准确的目标设计');
      expect(selectPaletteSeries().value).toBe('builtin:MARD');
      fireEvent.click(screen.getByRole('button', { name: '应用到这张图纸' }));
      expect(selectPaletteSeries().value).toBe(value);
      expect(new URLSearchParams(window.location.search).has('palette')).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.undoRegeneration }));
      expect(selectPaletteSeries().value).toBe('builtin:MARD');
      fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
      await waitFor(() => expect(JSON.parse(storage.designs.get('chosen')!.projectJson).pattern).toEqual(original.pattern));
    } finally { view.unmount(); window.history.replaceState(null, '', '/app'); }
  });

  it('色板选择缺少明确目标 ID 时不应用到自动恢复的其他图纸', async () => {
    window.history.replaceState(null, '', '/app?palette=builtin:MARD');
    const storage = new FakeStorage();
    storage.designs.set('last', record('last', savedProject('其他设计', '2026-08-14T12:00:00Z')));
    const view = render(<Workbench storage={storage} />);
    try {
      await screen.findByDisplayValue('其他设计');
      expect(screen.queryByRole('button', { name: '应用到这张图纸' })).toBeNull();
    } finally { view.unmount(); window.history.replaceState(null, '', '/app'); }
  });

  it('恢复图纸先继续制作，用户需要裁剪时才提示重新选择原图', async () => {
    const storage = new FakeStorage();
    await renderRestored(storage);
    expect(screen.queryByText(zhCN.workbench.cropSourceMissing)).not.toBeInTheDocument();
    const crop = screen.getByRole('button', { name: zhCN.crop.title });
    expect(crop).toBeEnabled();
    fireEvent.click(crop);
    expect(screen.getByText(zhCN.workbench.cropSourceMissing)).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: zhCN.params.targetWidth })).toBeDisabled();
    fireEvent.click(crop);
    expect(screen.queryByText(zhCN.workbench.cropSourceMissing)).not.toBeInTheDocument();
  });

  it('手机画布不会在配额错误时显示绿色已保存', async () => {
    const restoreViewport = mockMobileViewport();
    try {
      const storage = new FakeStorage();
      const name = await renderRestored(storage);
      storage.quotaExceeded = true;
      fireEvent.change(name, { target: { value: '尚未写入' } });
      fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
      await screen.findByText(zhCN.workbench.quotaError);
      const header = document.querySelector('.mobile-canvas-shell > header')!;
      expect(header).toHaveTextContent(zhCN.workbench.saveFailed);
      expect(header).not.toHaveTextContent(zhCN.workbench.saved);
    } finally { restoreViewport(); }
  });

  it('指定设计不在本机时给出明确返回入口，不误开其他记录', async () => {
    window.history.replaceState(null, '', '/app?id=missing');
    const storage = new FakeStorage();
    storage.designs.set('other', record('other', savedProject('其他作品', '2026-09-01T00:00:00Z')));
    render(<Workbench storage={storage} />);
    expect(await screen.findByText('这张设计不在本机，请回到我的设计下载或选择其他图纸。')).toBeVisible();
    expect(screen.queryByDisplayValue('其他作品')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回我的设计' })).toHaveAttribute('href', '/designs');
    window.history.replaceState(null, '', '/app');
  });

  it('生成源读取失败仍能打开完整图纸，保存不清除原有生成源', async () => {
    const storage = new FakeStorage();
    storage.designs.set('source-read', record('source-read', savedProject('可以继续编辑', '2026-09-01T00:00:00Z')));
    vi.spyOn(storage, 'getGenerationSource').mockRejectedValueOnce(new Error('source read failed'));
    const put = vi.spyOn(storage, 'put');
    render(<Workbench storage={storage} />);
    const name = await screen.findByDisplayValue('可以继续编辑');
    expect(screen.getByRole('tab', { name: zhCN.workbench.editTab })).toBeEnabled();
    expect(screen.getByRole('spinbutton', { name: zhCN.params.targetWidth })).toBeDisabled();
    fireEvent.change(name, { target: { value: '已编辑' } });
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls.at(-1)?.[1]).toBeUndefined();
    expect(JSON.parse(storage.designs.get('source-read')!.projectJson).name).toBe('已编辑');
  });
  it.each(['edit', 'stitch'] as const)('明确的 %s 恢复入口直接打开指定设计的任务', async (mode) => {
    window.history.replaceState(null, '', `/app?id=chosen&mode=${mode}`);
    const storage = new FakeStorage();
    storage.designs.set('chosen', record('chosen', savedProject('选中的作品', '2026-09-01T00:00:00Z')));
    storage.designs.set('other', record('other', savedProject('另一张作品', '2026-09-02T00:00:00Z')));
    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('选中的作品');
    expect(screen.getByRole('tab', { name: mode === 'edit' ? zhCN.workbench.editTab : zhCN.stitch.tab })).toHaveAttribute('aria-selected', 'true');
    window.history.replaceState(null, '', '/app');
  });
  it.each(['failure', 'cancel', 'undo'] as const)('重新裁剪 %s 后保存的图纸与本地生成源保持匹配', async (ending) => {
    const storage = new FakeStorage();
    let finish!: (output: EngineOutput) => void;
    let fail!: (error: Error) => void;
    let cropOutput!: EngineOutput;
    let calls = 0;
    const generate: typeof runGenerate = (input, progress) => {
      calls += 1;
      if (calls === 1) return instantGenerate(input, progress);
      void instantGenerate(input, progress).promise.then((output) => { cropOutput = output; });
      return { promise: new Promise((resolve, reject) => { finish = resolve; fail = reject; }), cancel: vi.fn() };
    };
    render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={generate} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await screen.findByText(/共 10000 粒/);
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await screen.findByText(zhCN.workbench.saved);
    const id = [...storage.designs.keys()][0];
    const original = storage.sources.get(id)!;
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.title }));
    fireEvent.keyDown(screen.getByLabelText(zhCN.crop.ariaCropCanvas), { key: 'ArrowLeft', altKey: true });
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.confirm }));
    await waitFor(() => expect(calls).toBe(2));
    expect(storage.sources.get(id)).toEqual(original);
    if (ending === 'failure') await act(async () => fail(new Error('failed')));
    else if (ending === 'cancel') fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.cancel }));
    else {
      await act(async () => finish(cropOutput));
      fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
      await waitFor(() => expect(storage.sources.get(id)?.width).toBe(7));
      fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.undoRegeneration }));
      fireEvent.click(screen.getByRole('button', { name: zhCN.crop.title }));
      expect(screen.getByText(zhCN.crop.sizeLabel(8, 8))).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: zhCN.crop.cancel }));
    }
    await screen.findByText(/共 10000 粒/);
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await screen.findByText(zhCN.workbench.saved);
    expect(storage.sources.get(id)).toEqual(original);
    expect(JSON.parse(storage.designs.get(id)!.projectJson).pattern.height).toBe(100);
  });
  it('首次自动生成失败释放原图并返回可重新选图的状态', async () => {
    const decoder: ImageDecoder = {
      load: vi.fn(async (): Promise<DecodeResult> => ({ ok: true, image: fakeImage })),
      region: vi.fn(async (): Promise<DecodeResult> => ({ ok: true, image: fakeImage })),
      clear: vi.fn(), dispose: vi.fn(),
    };
    render(<Workbench storage={new FakeStorage()} imageDecoder={decoder} generateFn={() => ({ promise: Promise.reject(new Error('worker failed')), cancel: vi.fn() })} />);
    const cleared = vi.mocked(decoder.clear).mock.calls.length;
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await screen.findByText(zhCN.workbench.generateFailed);
    expect(selectUploadInput()).toBeInTheDocument();
    expect(vi.mocked(decoder.clear).mock.calls.length).toBeGreaterThan(cleared);
  });
  it('卸载会清除会话原图且迟到解码不能启动生成', async () => {
    let finishLoad!: (result: DecodeResult) => void;
    const decoder: ImageDecoder = {
      load: vi.fn(() => new Promise<DecodeResult>((resolve) => { finishLoad = resolve; })),
      region: vi.fn(async (): Promise<DecodeResult> => ({ ok: true, image: fakeImage })),
      clear: vi.fn(), dispose: vi.fn(),
    };
    const generate = vi.fn(instantGenerate);
    const { unmount } = render(<Workbench storage={new FakeStorage()} imageDecoder={decoder} generateFn={generate} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await waitFor(() => expect(decoder.load).toHaveBeenCalledOnce());
    unmount();
    await act(async () => finishLoad({ ok: true, image: fakeImage }));
    expect(decoder.clear).toHaveBeenCalled();
    expect(decoder.region).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('裁剪解码期间重复确认只派发一次，取消后迟到结果不改图纸', async () => {
    let resolveCrop!: (result: DecodeResult) => void;
    const decoder: ImageDecoder = {
      load: vi.fn(async (): Promise<DecodeResult> => ({ ok: true, image: fakeImage })),
      region: vi.fn().mockResolvedValueOnce({ ok: true, image: fakeImage })
        .mockImplementation(() => new Promise<DecodeResult>((resolve) => { resolveCrop = resolve; })),
      clear: vi.fn(), dispose: vi.fn(),
    };
    const generate = vi.fn(instantGenerate);
    render(<Workbench storage={new FakeStorage()} imageDecoder={decoder} generateFn={generate} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await screen.findByText(/共 10000 粒/);
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.title }));
    const apply = screen.getByRole('button', { name: zhCN.crop.confirm });
    fireEvent.click(apply);
    fireEvent.click(apply);
    expect(decoder.region).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.cancel }));
    await act(async () => resolveCrop({ ok: true, image: fakeImage }));
    expect(generate).toHaveBeenCalledOnce();
    expect(screen.getByText(/共 10000 粒/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: zhCN.crop.title })).toBeEnabled();
  });

  it('重新裁剪只在确认覆盖手工修补后生成，拒绝和取消不改图纸', async () => {
    const generate = vi.fn(instantGenerate);
    render(<Workbench storage={new FakeStorage()} decodeFn={fakeDecode} generateFn={generate} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await screen.findByText(/共 10000 粒/);
    fireEvent.click(screen.getByRole('tab', { name: zhCN.workbench.editTab }));
    const canvas = screen.getByLabelText(zhCN.editor.canvasAria);
    fireEvent.pointerDown(canvas, { clientX: 320, clientY: 260, pointerType: 'mouse', pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 320, clientY: 260, pointerType: 'mouse', pointerId: 1 });
    fireEvent.click(screen.getByRole('tab', { name: zhCN.workbench.previewTab }));
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.title }));
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.confirm }));
    const warning = await screen.findByRole('dialog', { name: zhCN.workbench.confirmRegenerateTitle });
    fireEvent.click(within(warning).getByRole('button', { name: zhCN.common.cancel }));
    expect(generate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.cancel }));
    expect(screen.getByText(/共 10000 粒/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.title }));
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.confirm }));
    fireEvent.click(await screen.findByRole('button', { name: zhCN.workbench.confirmRegenerateAction }));
    await screen.findByRole('button', { name: zhCN.workbench.undoRegeneration });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('默认图片解码模块只加载一次压缩源，确认裁剪仅发送自然坐标', async () => {
    const preview = (await fakeDecode(new Uint8Array(), 'png')) as Extract<DecodeResult, { ok: true }>;
    const decoder: ImageDecoder = {
      load: vi.fn(async () => preview),
      region: vi.fn(async (): Promise<DecodeResult> => ({ ok: true, image: preview.image })),
      clear: vi.fn(),
      dispose: vi.fn(),
    };
    const { unmount } = render(
      <Workbench storage={new FakeStorage()} imageDecoder={decoder} generateFn={instantGenerate} />,
    );
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await screen.findByText(/共 10000 粒/);
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.title }));
    expect(screen.getByLabelText(zhCN.crop.ariaCropCanvas)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.cancel }));
    expect(screen.getByText(/共 10000 粒/)).toBeInTheDocument();
    expect(decoder.region).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.title }));
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.useWholeImage }));
    await screen.findByText(/共 10000 粒/);
    expect(decoder.load).toHaveBeenCalledOnce();
    expect(decoder.region).toHaveBeenCalledTimes(2);
    expect(decoder.region).toHaveBeenCalledWith(
      { x: 0, y: 0, width: 8, height: 8 },
      800,
    );
    unmount();
    expect(decoder.dispose).not.toHaveBeenCalled();
  });

  it('上传后整图自动生成首版，无需确认裁剪；参数面板仍可重生成', async () => {
    const storage = new FakeStorage();
    render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={instantGenerate} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });

    // 工作台：默认 targetWidth=100 → 8×8 图 → 100×100 = 10000 粒
    await screen.findByText(/共 10000 粒/);
    expect(screen.queryByLabelText(zhCN.crop.ariaCropCanvas)).not.toBeInTheDocument();
    expect(screen.getByText(zhCN.workbench.previewTab)).toBeTruthy();
    expect(screen.getByText(zhCN.workbench.editTab)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(screen.getByRole('button', { name: '下载 PNG' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '参数' }));

    // 参数面板接线：宽度输入 20 → blur 提交 → 300ms 防抖 → 重生成 20×20 = 400 粒
    const widthInput = screen.getByRole('spinbutton', { name: zhCN.params.targetWidth }) as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '20' } });
    fireEvent.blur(widthInput);
    await waitFor(() => expect(screen.getByText(/共 400 粒/)).toBeTruthy(), { timeout: 5000 });
  });

  it('生成完成有可感知反馈：结果句被播报，且步骤指示器停在工作台（D-1/D-2）', async () => {
    render(<Workbench storage={new FakeStorage()} decodeFn={fakeDecode} generateFn={instantGenerate} />);
    // 裁剪不是必经步骤；选图后直接进入工作台。
    expect(screen.getByText(zhCN.workbench.stepUpload).closest('[aria-current="step"]')).toBeTruthy();

    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    expect(screen.queryByText(zhCN.workbench.stepCrop)).not.toBeInTheDocument();
    await screen.findByText(/共 10000 粒/);

    // 生成完成的结果句：以 role=status 播报尺寸与用量（此前生成完成完全静默）
    const done = await waitFor(() => {
      const match = screen
        .getAllByRole('status')
        .find((node) => node.textContent?.includes('图纸已生成'));
      if (!match) throw new Error('missing generation result announcement');
      return match;
    });
    expect(done.textContent).toContain('100 × 100 格');
    // 「工作台」在头部标题里也出现，因此把断言限定在步骤导航内
    const steps = within(screen.getByRole('navigation', { name: zhCN.workbench.stepsAria }));
    expect(steps.getByText(zhCN.workbench.stepWorkspace).closest('[aria-current="step"]')).toBeTruthy();
  });

  it('手工修补后重生成需确认，取消会回滚参数，确认后可恢复修补快照', async () => {
    const storage = new FakeStorage();
    render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={instantGenerate} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
    await screen.findByText(/共 10000 粒/);

    fireEvent.click(screen.getByText(zhCN.workbench.editTab));
    const canvas = screen.getByLabelText(zhCN.editor.canvasAria);
    // 有界视窗把整图居中；使用视窗中心命中图纸，而不是假定左上角从 (0,0) 开始。
    fireEvent.pointerDown(canvas, { clientX: 320, clientY: 260, pointerType: 'mouse', pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 320, clientY: 260, pointerType: 'mouse', pointerId: 1 });

    // C-7：破坏性确认改用品牌弹窗（不再是 window.confirm）
    const widthInput = screen.getByRole('spinbutton', { name: zhCN.params.targetWidth }) as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '20' } });
    fireEvent.blur(widthInput);
    // CI（覆盖率插桩 + 单 worker）下防抖→脏状态→弹窗的级联可能超过默认 1s，放宽到 5s。
    const cancelButton = await screen.findByRole('button', { name: zhCN.common.cancel }, { timeout: 5000 });
    fireEvent.click(cancelButton);
    await waitFor(() => expect(widthInput.value).toBe('100'));
    expect(screen.getByText(/共 10000 粒/)).toBeTruthy();

    fireEvent.change(widthInput, { target: { value: '20' } });
    fireEvent.blur(widthInput);
    fireEvent.click(await screen.findByRole('button', { name: zhCN.workbench.confirmRegenerateAction }, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByText(/共 400 粒/)).toBeTruthy(), { timeout: 5000 });
    fireEvent.click(screen.getByText(zhCN.workbench.undoRegeneration));
    await waitFor(() => expect(screen.getByText(/共 10000 粒/)).toBeTruthy());
    expect(screen.queryByText(zhCN.workbench.undoRegeneration)).toBeNull();
  }, 20_000);

  it('手工修补后切换套装档位必须先确认，取消不改变档位也不重生成', async () => {
    const generateFn = vi.fn(instantGenerate);
    render(<Workbench storage={new FakeStorage()} decodeFn={fakeDecode} generateFn={generateFn} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
    await screen.findByText(/共 10000 粒/);

    fireEvent.click(screen.getByText(zhCN.workbench.editTab));
    const canvas = screen.getByLabelText(zhCN.editor.canvasAria);
    fireEvent.pointerDown(canvas, { clientX: 320, clientY: 260, pointerType: 'mouse', pointerId: 91 });
    fireEvent.pointerUp(canvas, { clientX: 320, clientY: 260, pointerType: 'mouse', pointerId: 91 });

    const kit = screen.getByLabelText(zhCN.params.kitTier) as HTMLSelectElement;
    fireEvent.change(kit, { target: { value: '24' } });
    fireEvent.click(await screen.findByRole('button', { name: zhCN.common.cancel }, { timeout: 5000 }));
    await waitFor(() => expect(kit.value).toBe('0'));
    expect(generateFn).toHaveBeenCalledTimes(1);

    fireEvent.change(kit, { target: { value: '24' } });
    fireEvent.click(await screen.findByRole('button', { name: zhCN.workbench.confirmRegenerateAction }, { timeout: 5000 }));
    await waitFor(() => expect(generateFn).toHaveBeenCalledTimes(2));
    expect(kit.value).toBe('24');
  }, 20_000);

  it('套装档位重生成失败时回滚档位与实际色集', async () => {
    let calls = 0;
    const generateFn: typeof runGenerate = (request, onProgress): GenerateTask => {
      calls += 1;
      if (calls === 1) return instantGenerate(request, onProgress);
      return { promise: Promise.reject(new Error('worker failed')), cancel: vi.fn() };
    };
    render(<Workbench storage={new FakeStorage()} decodeFn={fakeDecode} generateFn={generateFn} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
    await screen.findByText(/共 10000 粒/);

    fireEvent.change(screen.getByLabelText(zhCN.params.kitTier), { target: { value: '24' } });
    await screen.findByText(zhCN.workbench.generateFailed);
    await waitFor(() => expect(
      (screen.getByLabelText(zhCN.params.kitTier) as HTMLSelectElement).value,
    ).toBe('0'));
  });

  it('取消套装档位重生成时回滚档位与实际色集', async () => {
    let calls = 0;
    const cancel = vi.fn();
    const generateFn: typeof runGenerate = (request, onProgress): GenerateTask => {
      calls += 1;
      if (calls === 1) return instantGenerate(request, onProgress);
      return { promise: new Promise(() => undefined), cancel };
    };
    render(<Workbench storage={new FakeStorage()} decodeFn={fakeDecode} generateFn={generateFn} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
    await screen.findByText(/共 10000 粒/);

    fireEvent.change(screen.getByLabelText(zhCN.params.kitTier), { target: { value: '24' } });
    fireEvent.click(await screen.findByRole('button', { name: zhCN.workbench.cancel }));
    expect(cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(
      (screen.getByLabelText(zhCN.params.kitTier) as HTMLSelectElement).value,
    ).toBe('0'));
  });

  it('纯参数重生成失败释放完整原图，但回滚参数并保留图纸和本地生成源', async () => {
    let calls = 0;
    const generateFn: typeof runGenerate = (request, onProgress): GenerateTask => {
      calls += 1;
      if (calls === 1) return instantGenerate(request, onProgress);
      return {
        promise: Promise.reject(new Error('worker failed')),
        cancel: vi.fn(),
      };
    };
    const storage = new FakeStorage();
    const decoder: ImageDecoder = {
      load: vi.fn(async (): Promise<DecodeResult> => ({ ok: true, image: fakeImage })),
      region: vi.fn(async (): Promise<DecodeResult> => ({ ok: true, image: fakeImage })),
      clear: vi.fn(), dispose: vi.fn(),
    };
    render(<Workbench storage={storage} imageDecoder={decoder} generateFn={generateFn} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
    await screen.findByText(/共 10000 粒/);
    const clears = vi.mocked(decoder.clear).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await screen.findByText(zhCN.workbench.saved);
    const originalSource = [...storage.sources.values()][0];

    const widthInput = screen.getByRole('spinbutton', { name: zhCN.params.targetWidth }) as HTMLInputElement;
    // Drive the documented 300 ms debounce explicitly; full coverage under
    // concurrent browser/build load must not race Testing Library's 1 s clock.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.change(widthInput, { target: { value: '20' } });
      fireEvent.blur(widthInput);
      await act(async () => vi.advanceTimersByTimeAsync(300));
    } finally { vi.useRealTimers(); }

    await screen.findByText(zhCN.workbench.generateFailed);
    await waitFor(() => expect(
      (screen.getByRole('spinbutton', { name: zhCN.params.targetWidth }) as HTMLInputElement).value,
    ).toBe('100'));
    expect(screen.getByText(/共 10000 粒/)).toBeTruthy();
    expect(screen.queryByText(/共 400 粒/)).toBeNull();
    expect(vi.mocked(decoder.clear).mock.calls.length).toBeGreaterThan(clears);
    expect(screen.getByRole('button', { name: zhCN.crop.title })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.title }));
    expect(screen.getByText(zhCN.workbench.cropSourceMissing)).toBeInTheDocument();
    expect(widthInput).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await screen.findByText(zhCN.workbench.saved);
    expect([...storage.sources.values()][0]).toEqual(originalSource);
  });

  it('首次生成取消后返回可重新上传状态，不留下空白工作台', async () => {
    const cancel = vi.fn();
    const generateFn: typeof runGenerate = () => ({
      promise: new Promise(() => undefined),
      cancel,
    });
    render(<Workbench storage={new FakeStorage()} decodeFn={fakeDecode} generateFn={generateFn} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole('button', { name: zhCN.workbench.cancel }));

    expect(cancel).toHaveBeenCalledOnce();
    expect(await screen.findByLabelText(zhCN.upload.inputLabel)).toBeTruthy();
    expect(screen.queryByText(zhCN.workbench.previewTab)).toBeNull();
  });

  it('重新生成进行中禁用分享，不会创建旧图纸快照', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(JSON.stringify({ path: '/s/should-not-exist' }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);
    let calls = 0;
    const generateFn: typeof runGenerate = (request, onProgress): GenerateTask => {
      calls += 1;
      if (calls === 1) return instantGenerate(request, onProgress);
      return { promise: new Promise(() => undefined), cancel: vi.fn() };
    };
    try {
      render(<Workbench storage={new FakeStorage()} decodeFn={fakeDecode} generateFn={generateFn} />);
      fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
      await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
      await screen.findByText(/共 10000 粒/);
      fireEvent.click(screen.getByRole('button', { name: '导出' }));
      await waitFor(() => expect(screen.getByRole('button', { name: zhCN.share.button })).not.toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: '参数' }));
      const widthInput = screen.getByRole('spinbutton', { name: zhCN.params.targetWidth });
      fireEvent.change(widthInput, { target: { value: '20' } });
      fireEvent.blur(widthInput);
      await screen.findByRole('button', { name: zhCN.workbench.cancel });
      fireEvent.click(screen.getByRole('button', { name: '导出' }));
      const share = screen.getByRole('button', { name: zhCN.share.button });
      expect(share).toBeDisabled();
      expect(share).toHaveAttribute('title', zhCN.share.generationInProgress);
      fireEvent.click(share);
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/share'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('解码失败显示错误文案（不进入裁剪）', async () => {
    const storage = new FakeStorage();
    render(
      <Workbench storage={storage} decodeFn={() => Promise.resolve({ ok: false, code: 'DECODE_FAILED' })} />,
    );
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await screen.findByText(zhCN.errors.DECODE_FAILED);
    expect(screen.queryByText(zhCN.crop.title)).toBeNull();
  });
});

describe('Workbench 项目操作栏', () => {
  it('游客把重新上传留在菜单，并提供纵向登录与注册操作', async () => {
    resetAuthStatusCache();
    await renderRestored(new FakeStorage());

    const more = await screen.findByRole('button', { name: zhCN.nav.more });
    fireEvent.click(more);
    const panel = screen.getByRole('region', { name: zhCN.nav.more });
    const login = within(panel).getByRole('link', { name: zhCN.nav.login });
    const register = within(panel).getByRole('link', { name: zhCN.nav.registerAccount });
    expect(login).toHaveClass('btn-primary', 'workspace-overflow-action');
    expect(register).toHaveClass('btn-outline', 'workspace-overflow-action');
    expect(within(panel).getByRole('button', { name: zhCN.workbench.restart })).toBeTruthy();
  });

  it('登录后不展示邮箱，并把重新上传与保存并列放在项目操作栏', async () => {
    resetAuthStatusCache();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/me') {
        return new Response(JSON.stringify({ email: 'a@b.com', username: '小豆', emailVerified: true }), { status: 200 });
      }
      if (url === '/api/config') return new Response(null, { status: 404 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));
    try {
      await renderRestored(new FakeStorage());
      const actions = await waitFor(() => {
        const element = document.querySelector('.workbench-save-actions');
        expect(element).toBeTruthy();
        return element as HTMLElement;
      });
      expect(within(actions).getByRole('button', { name: zhCN.workbench.save })).toBeTruthy();
      expect(within(actions).getByRole('button', { name: zhCN.workbench.restart })).toBeTruthy();
      expect(screen.queryByText('a@b.com')).toBeNull();
      expect(screen.queryByRole('button', { name: zhCN.nav.more })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      resetAuthStatusCache();
    }
  });
});

describe('Workbench 本地保存', () => {
  it('保存裁剪后的生成源，刷新后恢复并可继续调参，项目 JSON 不携带源', async () => {
    window.history.replaceState(null, '', '/app');
    const storage = new FakeStorage();
    const first = render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={instantGenerate} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
    await screen.findByText(/共 10000 粒/);
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));

    await waitFor(() => expect(storage.sources.size).toBe(1));
    const [[savedId, savedSource]] = [...storage.sources.entries()];
    expect(savedSource.width).toBe(8);
    expect(savedSource.height).toBe(8);
    expect([...new Uint8ClampedArray(savedSource.rgba)]).toEqual([...fakeImage.data]);
    const storedProject = storage.designs.get(savedId)!;
    expect(storedProject.projectJson).not.toContain('generationSource');
    expect(storedProject.projectJson).not.toContain('rgba');
    expect(storage.sourceReplaceCount).toBe(1);

    fireEvent.change(screen.getByLabelText(zhCN.workbench.designName), { target: { value: '只改名称' } });
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await waitFor(() => expect(storage.designs.get(savedId)?.name).toBe('只改名称'));
    expect(storage.sourceReplaceCount).toBe(1);

    first.unmount();
    render(<Workbench storage={storage} generateFn={instantGenerate} />);
    await screen.findByDisplayValue('只改名称');
    expect(screen.getByRole('button', { name: zhCN.crop.title })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.title }));
    expect(screen.getByText(zhCN.workbench.cropSourceMissing)).toBeInTheDocument();
    expect(screen.queryByText(zhCN.workbench.sourceRequired)).toBeNull();
    const widthInput = screen.getByRole('spinbutton', { name: zhCN.params.targetWidth }) as HTMLInputElement;
    expect(widthInput.disabled).toBe(false);
    fireEvent.change(widthInput, { target: { value: '20' } });
    fireEvent.blur(widthInput);
    await screen.findByText(/共 400 粒/, undefined, { timeout: 5000 });
  });

  it('首次保存生成源遇到配额失败时不落半份数据，也不显示已保存', async () => {
    const storage = new FakeStorage();
    render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={instantGenerate} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
    await screen.findByText(/共 10000 粒/);
    storage.quotaExceeded = true;
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));

    await screen.findByText(zhCN.workbench.quotaError);
    expect(storage.designs.size).toBe(0);
    expect(storage.sources.size).toBe(0);
    expect(screen.queryByText(zhCN.workbench.saved)).toBeNull();
  });

  it('恢复最后设计：刷新后进入工作台并显示名称', async () => {
    const storage = new FakeStorage();
    await renderRestored(storage);
    expect(screen.getByText(zhCN.workbench.previewTab)).toBeTruthy();
  });

  it('自动保存：修改名称后 1s 防抖写入存储', async () => {
    const storage = new FakeStorage();
    const nameInput = await renderRestored(storage);

    vi.useFakeTimers();
    try {
      fireEvent.change(nameInput, { target: { value: '改名后的设计' } });
      await act(async () => {
        vi.advanceTimersByTime(1100);
      });
      const saved = [...storage.designs.values()];
      expect(saved).toHaveLength(1);
      expect(saved[0].name).toBe('改名后的设计');
      expect(screen.getByText(zhCN.workbench.saved)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('自动保存等待存储锁期间继续编辑，不会写入旧代际快照', async () => {
    const storage = new FakeStorage();
    const writtenNames: string[] = [];
    const put = storage.put.bind(storage);
    vi.spyOn(storage, 'put').mockImplementation(async (next, sourceWrite) => {
      writtenNames.push(next.name);
      await put(next, sourceWrite);
    });
    const nameInput = await renderRestored(storage);

    let blockedRun!: () => Promise<unknown>;
    let markSaveWaiting!: () => void;
    const saveWaiting = new Promise<void>((resolve) => { markSaveWaiting = resolve; });
    let releaseStorageLock!: () => Promise<void>;
    withDesignStorageLockMock
      .mockImplementationOnce((run: () => Promise<unknown>) => {
        blockedRun = run;
        markSaveWaiting();
        return new Promise<unknown>((resolve, reject) => {
          releaseStorageLock = async () => {
            try {
              resolve(await blockedRun());
            } catch (error) {
              reject(error);
            }
          };
        });
      })
      .mockImplementation((run: () => Promise<unknown>) => run());

    vi.useFakeTimers();
    try {
      fireEvent.change(nameInput, { target: { value: '第一版' } });
      await act(async () => {
        vi.advanceTimersByTime(1100);
        await saveWaiting;
      });
      fireEvent.change(nameInput, { target: { value: '第二版' } });

      await act(async () => {
        await releaseStorageLock();
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(1100);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(writtenNames).toEqual(['第二版']);
      expect(storage.designs.get('id-last')?.name).toBe('第二版');
    } finally {
      vi.useRealTimers();
      withDesignStorageLockMock.mockReset();
      withDesignStorageLockMock.mockImplementation((run: () => Promise<unknown>) => run());
    }
  });

  it('手动保存按钮立即写入', async () => {
    const storage = new FakeStorage();
    enqueueDesignSyncMock.mockClear();
    await renderRestored(storage);
    fireEvent.click(screen.getByText(zhCN.workbench.save));
    await waitFor(() => expect(screen.getByText(zhCN.workbench.saved)).toBeTruthy(), { timeout: 3000 });
    expect(storage.designs.size).toBe(1);
    expect(enqueueDesignSyncMock).not.toHaveBeenCalled();
  });

  it('配额满：保存失败显示导出项目文件建议（E39）', async () => {
    const storage = new FakeStorage();
    const nameInput = await renderRestored(storage);

    vi.useFakeTimers();
    try {
      storage.quotaExceeded = true;
      fireEvent.change(nameInput, { target: { value: '触发配额' } });
      await act(async () => {
        vi.advanceTimersByTime(1100);
      });
      expect(screen.getByText(zhCN.workbench.quotaError)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('存储不可用：显示提示且不崩溃', async () => {
    render(<Workbench storage={null} />);
    await waitFor(() => expect(screen.getByText(zhCN.workbench.unavailable)).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByLabelText(zhCN.upload.inputLabel)).toBeTruthy();
  });

  it('站内导航会先等待本地保存，成功时不弹窗', async () => {
    const storage = new FakeStorage();
    const nameInput = await renderRestored(storage);
    pushMock.mockClear();
    fireEvent.change(nameInput, { target: { value: '离开前保存' } });
    fireEvent.click(screen.getAllByRole('link', { name: zhCN.nav.designs })[0]);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/designs'));
    expect([...storage.designs.values()][0].name).toBe('离开前保存');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('重新上传保存失败时只在用户确认后才离开工作台', async () => {
    const storage = new FakeStorage();
    const nameInput = await renderRestored(storage);
    storage.quotaExceeded = true;
    fireEvent.change(nameInput, { target: { value: '未保存名称' } });

    // 第一次：在确认弹窗里点「取消」，留在工作台
    clickGuestRestart();
    fireEvent.click(await screen.findByRole('button', { name: zhCN.common.cancel }));
    expect(screen.getByText(zhCN.workbench.previewTab)).toBeTruthy();

    // 第二次：确认「仍要离开」，回到上传入口
    clickGuestRestart();
    fireEvent.click(await screen.findByRole('button', { name: zhCN.workbench.confirmLeaveAction }));
    await screen.findByLabelText(zhCN.upload.inputLabel);
  });

  it('恢复项目重新上传原图后保留当前设计身份并解锁重生成', async () => {
    window.history.replaceState(null, '', '/app?id=id-last');
    const storage = new FakeStorage();
    const original = savedProject('保留身份', '2026-08-14T12:00:00.000Z');
    storage.designs.set('id-last', record('id-last', original));
    render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={instantGenerate} />);
    await screen.findByDisplayValue('保留身份');
    expect(screen.getByRole('spinbutton', { name: zhCN.params.targetWidth })).toBeDisabled();

    clickGuestRestart();
    fireEvent.change(await screen.findByLabelText(zhCN.upload.inputLabel), { target: { files: [makeFile()] } });
    fireEvent.click(await screen.findByRole('button', { name: zhCN.workbench.confirmRegenerateAction }));
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());

    await waitFor(() => expect(screen.getByRole('spinbutton', { name: zhCN.params.targetWidth })).not.toBeDisabled());
    expect(screen.getByDisplayValue('保留身份')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await waitFor(() => expect(storage.designs.get('id-last')?.name).toBe('保留身份'));
    expect(storage.designs.size).toBe(1);
    expect(JSON.parse(storage.designs.get('id-last')!.projectJson).createdAt).toBe(original.createdAt);
    expect(window.location.search).toBe('?id=id-last');
  });

  it('恢复项目重新选择原图后取消生成，不把新源错绑到旧图纸', async () => {
    window.history.replaceState(null, '', '/app?id=id-last');
    const storage = new FakeStorage();
    storage.designs.set('id-last', record('id-last', savedProject('取消重绑生成', '2026-08-14T12:00:00.000Z')));
    const cancel = vi.fn();
    const pendingGenerate: typeof runGenerate = () => ({
      promise: new Promise(() => undefined),
      cancel,
    });
    const first = render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={pendingGenerate} />);
    await screen.findByDisplayValue('取消重绑生成');

    clickGuestRestart();
    fireEvent.change(await screen.findByLabelText(zhCN.upload.inputLabel), { target: { files: [makeFile()] } });
    fireEvent.click(await screen.findByRole('button', { name: zhCN.workbench.confirmRegenerateAction }));
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole('button', { name: zhCN.workbench.cancel }));

    expect(cancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await screen.findByText(zhCN.workbench.saved);
    expect(storage.sources.has('id-last')).toBe(false);
    first.unmount();

    render(<Workbench storage={storage} generateFn={instantGenerate} />);
    await screen.findByDisplayValue('取消重绑生成');
    expect(screen.getByText(zhCN.workbench.sourceRequired)).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: zhCN.params.targetWidth })).toBeDisabled();
  });

  it('跟拼进度存本机并在重新打开后恢复（G-1）', async () => {
    const storage = new FakeStorage();
    const nameInput = await renderRestored(storage);
    expect(nameInput).toBeTruthy();

    // 切到跟拼页签，整行标记已拼
    fireEvent.click(screen.getByRole('tab', { name: zhCN.stitch.tab }));
    const markRow = await screen.findByRole('button', { name: zhCN.stitch.markRowDone });
    fireEvent.click(markRow);

    // 串行 latest 队列会异步落盘
    await waitFor(() => expect(storage.progress.has('id-last')).toBe(true), { timeout: 3000 });
    const saved = storage.progress.get('id-last')!;
    expect([...saved.done].some((value) => value === 1)).toBe(true);

    // 重新挂载：进度回来了（已拼数量不再是 0）
    cleanup();
    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('初始');
    fireEvent.click(screen.getByRole('tab', { name: zhCN.stitch.tab }));
    await waitFor(() => {
      const status = screen.getByText(/^已拼 \d+ \/ \d+ 粒/);
      expect(status.textContent).not.toMatch(/^已拼 0 \//);
    });
  });

  it('图纸尺寸变了就重置跟拼进度，不把「已拼」错位到新格子上（G-1）', async () => {
    const storage = new FakeStorage();
    storage.designs.set('id-last', record('id-last', savedProject('尺寸变化', '2026-08-14T12:00:00.000Z')));
    // 预置一份尺寸不匹配的旧进度（3×3，与保存的图纸尺寸不同）
    storage.progress.set('id-last', {
      version: 1,
      width: 3,
      height: 3,
      done: new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
      updatedAt: '2026-08-14T12:00:00.000Z',
    });
    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('尺寸变化');
    fireEvent.click(screen.getByRole('tab', { name: zhCN.stitch.tab }));
    // 旧进度被丢弃 → 已拼 0
    await waitFor(() => expect(screen.getByText(/已拼 0 \//)).toBeTruthy());
  });

  it('同尺寸换色板不重读存储，也不覆盖页面内最新跟拼进度', async () => {
    const storage = new FakeStorage();
    const readProgress = vi.spyOn(storage, 'getStitchProgress');
    await renderRestored(storage);
    await waitFor(() => expect(readProgress).toHaveBeenCalled());
    const readsAfterRestore = readProgress.mock.calls.length;

    fireEvent.click(screen.getByRole('tab', { name: zhCN.stitch.tab }));
    fireEvent.click(await screen.findByRole('button', { name: zhCN.stitch.markRowDone }));
    await screen.findByText(/^已拼 1 \/ 1 粒/);

    fireEvent.change(selectPaletteBrand(), { target: { value: 'COCO' } });
    await screen.findByText(/已换到新色板/);
    await act(async () => { await Promise.resolve(); });

    expect(readProgress).toHaveBeenCalledTimes(readsAfterRestore);
    expect(screen.getByText(/^已拼 1 \/ 1 粒/)).toBeTruthy();
  });

  it('跟拼进度串行写入且只保留等待期间的最新快照', async () => {
    const storage = new SerialStitchStorage();
    await renderRestored(storage);
    fireEvent.click(screen.getByRole('tab', { name: zhCN.stitch.tab }));

    fireEvent.click(await screen.findByRole('button', { name: zhCN.stitch.markRowDone }));
    await waitFor(() => expect(storage.writes).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: zhCN.stitch.markRowUndone }));

    // 第一笔还在途时，第二个状态只进入 latest 槽，不会并发写库。
    expect(storage.writes).toHaveLength(1);
    expect(storage.maxActiveWrites).toBe(1);
    storage.releaseFirst();

    await waitFor(() => expect(storage.writes).toHaveLength(2));
    await waitFor(() => expect(storage.progress.has('id-last')).toBe(true));
    expect(storage.maxActiveWrites).toBe(1);
    expect([...storage.writes[1].done].some(Boolean)).toBe(false);
    expect([...storage.progress.get('id-last')!.done].some(Boolean)).toBe(false);
  });

  it('跟拼保存失败保留页面内进度，并允许显式重试', async () => {
    const storage = new FakeStorage();
    await renderRestored(storage);
    fireEvent.click(screen.getByRole('tab', { name: zhCN.stitch.tab }));
    storage.quotaExceeded = true;
    fireEvent.click(await screen.findByRole('button', { name: zhCN.stitch.markRowDone }));

    await screen.findByText(zhCN.workbench.stitchSaveFailed);
    expect(screen.getByText(/^已拼 1 \/ 1 粒/)).toBeTruthy();
    expect(storage.progress.has('id-last')).toBe(false);

    storage.quotaExceeded = false;
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.stitchSaveRetry }));
    await waitFor(() => expect(storage.progress.has('id-last')).toBe(true));
    expect(screen.queryByText(zhCN.workbench.stitchSaveFailed)).toBeNull();
  });

  it('页面隐藏时会重试刷新最后一份跟拼状态', async () => {
    const storage = new FakeStorage();
    await renderRestored(storage);
    fireEvent.click(screen.getByRole('tab', { name: zhCN.stitch.tab }));
    storage.quotaExceeded = true;
    fireEvent.click(await screen.findByRole('button', { name: zhCN.stitch.markRowDone }));
    await screen.findByText(zhCN.workbench.stitchSaveFailed);

    storage.quotaExceeded = false;
    fireEvent(window, new Event('pagehide'));

    await waitFor(() => expect(storage.progress.has('id-last')).toBe(true));
  });
});

describe('Workbench 空白起稿与套装档位（H-2/H-3）', () => {
  it('把 13 套内置色板按品牌与系列完整展示，主文案不泄露稳定 ID', async () => {
    render(<Workbench storage={new FakeStorage()} />);
    await screen.findByLabelText(zhCN.params.brand);

    const brandSelect = selectPaletteBrand();
    const brands = [...brandSelect.options].map((option) => option.value);
    expect(brands).toEqual(['MARD', 'COCO', '漫漫', '盼盼', '咪小窝', '优肯 Artkal']);

    let seriesCount = 0;
    for (const brand of brands) {
      fireEvent.change(brandSelect, { target: { value: brand } });
      seriesCount += selectPaletteSeries().options.length;
    }
    expect(seriesCount).toBe(13);
    const visibleOptionCopy = [...document.querySelectorAll('select option')]
      .map((option) => option.textContent)
      .join(' ');
    expect(visibleOptionCopy).not.toMatch(/pcd:|[0-9a-f]{40}/i);
    expect([...document.querySelectorAll('details.palette-picker-technical')]
      .every((details) => !(details as HTMLDetailsElement).open)).toBe(true);
  });

  it('不上传图片也能进入工作台：空白图纸落在修补页签，参数锁定但可导出', async () => {
    render(<Workbench storage={new FakeStorage()} />);
    // 上传页同时给出空白起稿入口
    const blank = await screen.findByRole('button', { name: zhCN.workbench.blankPreset(1, 29) });
    fireEvent.click(blank);

    // 进入工作台，且直接在「修补」页签（空白图纸的第一步一定是画）
    await waitFor(() => expect(screen.getByRole('tab', { name: zhCN.workbench.editTab })).toHaveAttribute('aria-selected', 'true'));
    // 没有生成源 → 参数锁定
    expect(screen.getByRole('spinbutton', { name: zhCN.params.targetWidth })).toBeDisabled();
    // 但导出可用（空图纸导出按钮会自行判空）
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(screen.getByRole('button', { name: '下载 PNG' })).toBeVisible();
  });

  it('空白起稿可先选择 Mini 色板与 52×52 规格，并按一整板保存', async () => {
    const storage = new FakeStorage();
    render(<Workbench storage={storage} />);

    await screen.findByLabelText(zhCN.params.brand);
    fireEvent.change(selectPaletteBrand(), { target: { value: '优肯 Artkal' } });
    expect(selectPaletteSeries().value).toBe('builtin:pcd:artkal-c-197-official@178dafbc9e77d3de556550dbd058270200129186');

    const profileSelect = screen.getByLabelText(zhCN.params.boardProfile) as HTMLSelectElement;
    expect(profileSelect.value).toBe('2.6mm-50');
    fireEvent.change(profileSelect, { target: { value: '2.6mm-52' } });
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.blankPreset(1, 52) }));
    await screen.findByRole('tab', { name: zhCN.workbench.editTab });
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));

    await waitFor(() => expect(storage.designs.size).toBe(1));
    const project = JSON.parse([...storage.designs.values()][0].projectJson) as ProjectFile;
    expect(project.boardProfile).toBe('2.6mm-52');
    expect(project.pattern).toMatchObject({ width: 52, height: 52 });
    expect(project.paletteSelection.palette).toEqual({
      kind: 'builtin',
      brand: 'pcd:artkal-c-197-official@178dafbc9e77d3de556550dbd058270200129186',
    });
  });

  it('有生成源时选择 Mini 色板仍以一次重映射原子切规格，并可一步撤销', async () => {
    const generateFn = vi.fn(instantGenerate);
    render(<Workbench storage={new FakeStorage()} decodeFn={fakeDecode} generateFn={generateFn} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
    await screen.findByText(/共 10000 粒/);

    fireEvent.change(selectPaletteBrand(), { target: { value: '优肯 Artkal' } });

    const profile = screen.getByLabelText(zhCN.params.boardProfile) as HTMLSelectElement;
    await waitFor(() => expect(profile.value).toBe('2.6mm-50'));
    expect(generateFn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.undoRegeneration }));
    expect(profile.value).toBe('5mm-29');
    expect(selectPaletteBrand().value).toBe('MARD');
    expect(selectPaletteSeries().value).toBe('builtin:MARD');
  });

  it('同品牌切换系列只产生一份重映射快照，一步撤销恢复原系列', async () => {
    const storage = new FakeStorage();
    const project = savedProject('同品牌系列', '2026-08-14T12:00:00.000Z');
    project.paletteSelection.kitTier = 24;
    storage.designs.set('id-last', record('id-last', project));
    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('同品牌系列');

    const series = selectPaletteSeries();
    const publicMard = 'builtin:pcd:mard-291-github@178dafbc9e77d3de556550dbd058270200129186';
    expect([...series.options].map((option) => option.value)).toContain(publicMard);
    fireEvent.change(series, { target: { value: publicMard } });

    expect(selectPaletteBrand().value).toBe('MARD');
    expect(selectPaletteSeries().value).toBe(publicMard);
    expect((screen.getByLabelText(zhCN.params.kitTier) as HTMLSelectElement).value).toBe('24');
    const undo = screen.getByRole('button', { name: zhCN.workbench.undoRegeneration });
    fireEvent.click(undo);

    expect(selectPaletteBrand().value).toBe('MARD');
    expect(selectPaletteSeries().value).toBe('builtin:MARD');
    expect((screen.getByLabelText(zhCN.params.kitTier) as HTMLSelectElement).value).toBe('24');
    expect(screen.queryByRole('button', { name: zhCN.workbench.undoRegeneration })).toBeNull();
  });

  it('选套装档位后图纸只用档位内的色号（H-3）', async () => {
    const storage = new FakeStorage();
    storage.designs.set('id-last', record('id-last', savedProject('档位', '2026-08-14T12:00:00.000Z')));
    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('档位');

    const kit = screen.getByLabelText(zhCN.params.kitTier) as HTMLSelectElement;
    expect(kit).not.toBeDisabled(); // 与色板一样，不需要原图
    fireEvent.change(kit, { target: { value: '24' } });

    await waitFor(() => expect(screen.getByText(/已限定为 24 色套装/)).toBeTruthy());
    expect(screen.getByRole('button', { name: zhCN.workbench.undoRegeneration })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await waitFor(() => {
      const saved = JSON.parse(storage.designs.get('id-last')!.projectJson) as ProjectFile;
      expect(saved.paletteSelection).toEqual({
        palette: { kind: 'builtin', brand: 'MARD' },
        kitTier: 24,
      });
    });
  });

  it('重新打开已保存设计时恢复套装档位', async () => {
    const storage = new FakeStorage();
    const project = savedProject('恢复档位', '2026-08-14T12:00:00.000Z');
    project.paletteSelection.kitTier = 24;
    storage.designs.set('id-last', record('id-last', project));

    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('恢复档位');

    expect((screen.getByLabelText(zhCN.params.kitTier) as HTMLSelectElement).value).toBe('24');
  });

  it('导入另一项目时不继承上一设计的套装档位', async () => {
    const storage = new FakeStorage();
    storage.designs.set('id-last', record('id-last', savedProject('旧设计', '2026-08-14T12:00:00.000Z')));
    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('旧设计');

    const kit = screen.getByLabelText(zhCN.params.kitTier) as HTMLSelectElement;
    fireEvent.change(kit, { target: { value: '24' } });
    await waitFor(() => expect(kit.value).toBe('24'));

    const imported = savedProject('导入设计', '2026-08-15T12:00:00.000Z');
    const file = new File([JSON.stringify(imported)], 'import.doupu.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText(zhCN.project.importInputLabel), { target: { files: [file] } });

    await screen.findByDisplayValue('导入设计');
    expect((screen.getByLabelText(zhCN.params.kitTier) as HTMLSelectElement).value).toBe('0');
  });

  it('重新上传进入新设计后不继承上一设计的套装档位', async () => {
    const storage = new FakeStorage();
    render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={instantGenerate} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
    await screen.findByText(/共 10000 粒/);

    fireEvent.change(screen.getByLabelText(zhCN.params.kitTier), { target: { value: '24' } });
    await waitFor(() => expect((screen.getByLabelText(zhCN.params.kitTier) as HTMLSelectElement).value).toBe('24'));
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await waitFor(() => expect(storage.designs.size).toBe(1));
    clickGuestRestart();

    await screen.findByLabelText(zhCN.upload.inputLabel);
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.blankPreset(1, 29) }));
    await screen.findByRole('tab', { name: zhCN.workbench.editTab });
    expect((screen.getByLabelText(zhCN.params.kitTier) as HTMLSelectElement).value).toBe('0');
  });

  it('公开配置延迟返回不会覆盖用户已选的 Mini 色板与 52×52 规格', async () => {
    let resolveConfig!: (response: Response) => void;
    const configResponse = new Promise<Response>((resolve) => { resolveConfig = resolve; });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/config') return configResponse;
      return Promise.resolve(new Response(null, { status: 401 }));
    }));
    try {
      const generateFn = vi.fn(instantGenerate);
      render(<Workbench storage={new FakeStorage()} decodeFn={fakeDecode} generateFn={generateFn} />);
      fireEvent.change(selectPaletteBrand(), { target: { value: '优肯 Artkal' } });
      const selectedArtkalSeries = selectPaletteSeries().value;
      const profileSelect = screen.getByLabelText(zhCN.params.boardProfile) as HTMLSelectElement;
      fireEvent.change(profileSelect, { target: { value: '2.6mm-52' } });

      await act(async () => {
        resolveConfig(new Response(JSON.stringify({
          generation: { defaultWidth: 88, defaultColorCount: 32 },
          exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
          exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
        }), { status: 200 }));
        await configResponse;
      });

      fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
      await waitFor(() => expect(screen.queryByLabelText(zhCN.upload.inputLabel)).not.toBeInTheDocument());
      await screen.findByText(/共 7744 粒/);
      expect(selectPaletteBrand().value).toBe('优肯 Artkal');
      expect(selectPaletteSeries().value).toBe(selectedArtkalSeries);
      expect((screen.getByLabelText(zhCN.params.boardProfile) as HTMLSelectElement).value).toBe('2.6mm-52');
      expect(generateFn.mock.calls[0][0].params).toMatchObject({ targetWidth: 88, targetColorCount: 32 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('自定义色板可切换 2.6mm 规格，保存与一步撤销都包含制作规格', async () => {
    const storage = new FakeStorage();
    const project = savedProject('Mini', '2026-08-14T12:00:00.000Z');
    project.paletteSelection.palette = { kind: 'custom', colors: [{ code: 'H07', hex: '#000000' }] };
    storage.designs.set('id-last', record('id-last', project));
    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('Mini');
    expect(screen.getByText(zhCN.workbench.sourceRequired)).toBeTruthy();

    const profile = screen.getByLabelText(zhCN.params.boardProfile) as HTMLSelectElement;
    expect([...profile.options].map((option) => option.value)).toEqual(['5mm-29', '2.6mm-50', '2.6mm-52']);
    fireEvent.change(profile, { target: { value: '2.6mm-50' } });

    expect(profile.value).toBe('2.6mm-50');
    expect(screen.getByText(/制作规格已切换为 2.6mm \/ 50×50/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await waitFor(() => {
      const saved = storage.designs.get('id-last');
      expect(saved).toBeTruthy();
      expect((JSON.parse(saved!.projectJson) as ProjectFile).boardProfile).toBe('2.6mm-50');
    });

    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.undoRegeneration }));
    expect(profile.value).toBe('5mm-29');
    expect(screen.getByText(zhCN.workbench.sourceRequired)).toBeTruthy();
  });

  it('选择 Mini 专用内置色板时原子切到 2.6mm-50，并保存版本化色板 ID', async () => {
    const storage = new FakeStorage();
    storage.designs.set('id-last', record('id-last', savedProject('Artkal', '2026-08-14T12:00:00.000Z')));
    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('Artkal');

    fireEvent.change(selectPaletteBrand(), { target: { value: '优肯 Artkal' } });
    expect(selectPaletteSeries().value).toBe('builtin:pcd:artkal-c-197-official@178dafbc9e77d3de556550dbd058270200129186');
    const technicalDetails = screen.getByText(zhCN.params.paletteDataVersion).closest('details');
    expect(technicalDetails?.open).toBe(false);
    expect(technicalDetails?.textContent).toContain('178dafbc9e77d3de556550dbd058270200129186');

    const profile = screen.getByLabelText(zhCN.params.boardProfile) as HTMLSelectElement;
    await waitFor(() => expect(profile.value).toBe('2.6mm-50'));
    expect([...profile.options].map((option) => option.value)).toEqual(['2.6mm-50', '2.6mm-52']);
    expect(screen.getByText(/制作规格已切换为 2.6mm \/ 50×50/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await waitFor(() => {
      const saved = JSON.parse(storage.designs.get('id-last')!.projectJson) as ProjectFile;
      expect(saved.boardProfile).toBe('2.6mm-50');
      expect(saved.paletteSelection.palette).toEqual({
        kind: 'builtin',
        brand: 'pcd:artkal-c-197-official@178dafbc9e77d3de556550dbd058270200129186',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.undoRegeneration }));
    expect(profile.value).toBe('5mm-29');
    expect(selectPaletteBrand().value).toBe('MARD');
    expect(selectPaletteSeries().value).toBe('builtin:MARD');
  });
});

describe('Workbench 移动沉浸工作区', () => {
  it('进入编辑时压入同路由界面状态，顶部返回只退出到普通预览', async () => {
    const restoreViewport = mockMobileViewport();
    window.history.replaceState(null, '', '/app');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    try {
      const storage = new FakeStorage();
      await renderRestored(storage);
      const editTab = await screen.findByRole('tab', { name: zhCN.workbench.editTab });
      fireEvent.click(editTab);

      const workspace = await screen.findByTestId('mobile-immersive-workspace');
      expect(workspace).toBeTruthy();
      expect(window.location.pathname).toBe('/app');
      expect(window.history.state).toBeTruthy();

      fireEvent.click(within(workspace).getByRole('button', { name: /返回预览/ }));
      await waitFor(() => expect(screen.queryByTestId('mobile-immersive-workspace')).toBeNull());
      expect(back).toHaveBeenCalledOnce();
      expect(screen.getByRole('tab', { name: zhCN.workbench.previewTab })).toHaveAttribute('aria-selected', 'true');
    } finally {
      back.mockRestore();
      restoreViewport();
      cleanup();
    }
  });

  it('系统返回事件先退出沉浸跟拼，不离开 /app', async () => {
    const restoreViewport = mockMobileViewport();
    window.history.replaceState(null, '', '/app');
    try {
      const storage = new FakeStorage();
      await renderRestored(storage);
      fireEvent.click(await screen.findByRole('tab', { name: zhCN.stitch.tab }));
      await screen.findByTestId('mobile-immersive-workspace');

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      await waitFor(() => expect(screen.queryByTestId('mobile-immersive-workspace')).toBeNull());
      expect(window.location.pathname).toBe('/app');
      expect(screen.getByRole('tab', { name: zhCN.workbench.previewTab })).toHaveAttribute('aria-selected', 'true');
    } finally {
      restoreViewport();
      cleanup();
    }
  });
});

describe('Workbench 编辑与导出接缝', () => {  it('编辑模式落笔后 onPatternChange 触发自动保存', async () => {
    const storage = new FakeStorage();
    await renderRestored(storage);
    fireEvent.click(screen.getByText(zhCN.workbench.editTab));
    const canvas = screen.getByLabelText(zhCN.editor.canvasAria);

    vi.useFakeTimers();
    try {
      // 2×1 图纸以 64px 格居中在 640×520 视窗；(288,228) 是首格中心。
      fireEvent.pointerDown(canvas, { clientX: 288, clientY: 228, pointerType: 'mouse', pointerId: 1 });
      fireEvent.pointerUp(canvas, { clientX: 288, clientY: 228, pointerType: 'mouse', pointerId: 1 });
      await act(async () => {
        vi.advanceTimersByTime(1100);
      });
      const saved = [...storage.designs.values()][0];
      expect(saved).toBeTruthy();
      // 编辑已写入项目文件（黑色 H07 被画笔替换为 MARD 首色 A01）
      expect(saved.projectJson).toContain('A01');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Workbench 云端自定义色板（优化票 06）', () => {
  it('恢复项目无原图时锁定重生成，并按云端自定义色板 ID 撤销', async () => {
    enqueueDesignSyncMock.mockResolvedValue({
      pushed: 0,
      pulled: 0,
      overwrittenByCloud: [],
      conflictCopies: [],
      errors: [],
      syncedIds: ['id-last'],
      issues: [{
        designId: 'another-invalid-design',
        operation: 'validate-local',
        code: 'INVALID_PROJECT_V3',
        message: '本地项目不是严格 ProjectFile v3，已跳过同步',
      }],
      cloud: [],
    } as never);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') {
        return new Response(JSON.stringify({
          generation: { defaultWidth: 100, defaultColorCount: 40 },
          exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
          exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
        }), { status: 200 });
      }
      if (url === '/api/auth/me') {
        return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      }
      if (url === '/api/palettes') {
        return new Response(JSON.stringify({
          items: [
            { id: 'pal-1', name: '粉彩 A', colors: [{ hex: '#FFAA00', code: 'P1' }], updatedAt: '2026-08-15T00:00:00.000Z', revision: 1 },
            { id: 'pal-same-colors', name: '粉彩 B', colors: [{ hex: '#FFAA00', code: 'P1' }], updatedAt: '2026-08-15T00:00:00.000Z', revision: 1 },
            { id: 'pal-2', name: '空板', colors: [], updatedAt: '2026-08-15T00:00:00.000Z', revision: 1 },
          ],
          nextCursor: null,
        }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const storage = new FakeStorage();
    storage.designs.set('id-last', record('id-last', savedProject('初始', '2026-08-14T12:00:00.000Z')));
    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('初始');

    // 下拉出现两个同色但身份不同的云端色板；空色板被过滤。
    const brandSelect = (await screen.findByLabelText(zhCN.params.brand)) as HTMLSelectElement;
    await waitFor(() => {
      expect(brandSelect.textContent).toContain(zhCN.params.customPaletteGroup);
    });
    fireEvent.change(brandSelect, { target: { value: zhCN.params.customPaletteGroup } });
    const seriesSelect = selectPaletteSeries();
    expect(seriesSelect.value).toBe('');
    expect(seriesSelect.textContent).toContain('粉彩 A');
    expect(seriesSelect.textContent).toContain('粉彩 B');
    expect(seriesSelect.textContent).not.toContain('空板');

    // 项目文件不含原图：参数控件锁定（改参数要重新采样原图），
    // 但色板可以换——走图纸级重映射，保留手工修补（H-1）。
    expect(screen.getByRole('spinbutton', { name: zhCN.params.targetWidth })).toBeDisabled();
    expect(screen.getByText(zhCN.workbench.sourceRequired)).toBeTruthy();
    expect(brandSelect).not.toBeDisabled();
    fireEvent.change(seriesSelect, { target: { value: 'custom:pal-same-colors' } });
    await waitFor(() => expect(selectPaletteSeries().value).toBe('custom:pal-same-colors'));
    // 重映射结果有明确反馈，且提供一步撤销
    expect(screen.getByText(/已换到新色板/)).toBeTruthy();
    expect(screen.getByRole('button', { name: zhCN.workbench.undoRegeneration })).toBeTruthy();

    // 再换到内置色板后一步撤销，必须恢复刚才选中的 B；
    // 不能按颜色相等错误命中列表中排在前面的 A。
    fireEvent.change(selectPaletteBrand(), { target: { value: 'COCO' } });
    await waitFor(() => expect(selectPaletteSeries().value).toBe('builtin:COCO'));
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.undoRegeneration }));
    await waitFor(() => expect(selectPaletteSeries().value).toBe('custom:pal-same-colors'));

    await waitFor(() => expect(screen.getByText(zhCN.workbench.cloudSynced)).toBeTruthy());
    const callsBeforeOnline = enqueueDesignSyncMock.mock.calls.length;
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(enqueueDesignSyncMock).toHaveBeenCalledTimes(callsBeforeOnline + 1));

    vi.unstubAllGlobals();
  });

  it('活动设计发生 CAS 冲突后切换到冲突副本，后续保存不会覆盖云端原件', async () => {
    window.history.replaceState(null, '', '/app');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const storage = new FakeStorage();
    const local = savedProject('本机修改', '2026-08-14T12:00:00.000Z');
    storage.designs.set('id-last', record('id-last', local));
    const conflictProject = { ...local, name: '本机修改 (冲突副本)' };
    const remoteProject = savedProject('云端原件', '2026-08-14T13:00:00.000Z');
    enqueueDesignSyncMock
      .mockImplementationOnce(async () => {
        storage.designs.set('id-last', { ...record('id-last', remoteProject), revision: 2, syncState: 'synced' });
        storage.designs.set('conflict-id', { ...record('conflict-id', conflictProject), revision: 0, syncState: 'conflict' });
        return {
          pushed: 0,
          pulled: 1,
          overwrittenByCloud: ['id-last'],
          conflictCopies: [{ originalId: 'id-last', conflictId: 'conflict-id' }],
          errors: [],
          syncedIds: ['id-last'],
          issues: [],
          cloud: [],
        } as never;
      })
      .mockResolvedValue({ pushed: 0, pulled: 0, overwrittenByCloud: [], conflictCopies: [], errors: [], syncedIds: ['conflict-id'], issues: [], cloud: [] } as never);

    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('本机修改 (冲突副本)');
    expect(screen.getByText(zhCN.workbench.syncConflictCopy)).toBeTruthy();
    const nameInput = screen.getByLabelText(zhCN.workbench.designName);
    fireEvent.change(nameInput, { target: { value: '冲突副本继续编辑' } });
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await waitFor(() => expect(storage.designs.get('conflict-id')?.name).toBe('冲突副本继续编辑'));
    expect(storage.designs.get('id-last')?.name).toBe('云端原件');
    vi.unstubAllGlobals();
  });

  it('活动设计发生冲突后即使用户不再操作，也会自动保存副本并完成下一轮同步', async () => {
    window.history.replaceState(null, '', '/app');
    resetAuthStatusCache();
    enqueueDesignSyncMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));

    const storage = new FakeStorage();
    const local = savedProject('本机修改', '2026-08-14T12:00:00.000Z');
    const remote = savedProject('云端原件', '2026-08-14T13:00:00.000Z');
    const conflict = { ...local, name: '本机修改 (冲突副本)' };
    storage.designs.set('original-id', record('original-id', local));

    let releaseInitialSync!: () => void;
    const initialSyncGate = new Promise<void>((resolve) => { releaseInitialSync = resolve; });
    enqueueDesignSyncMock
      .mockImplementationOnce(async () => {
        await initialSyncGate;
        storage.designs.set('original-id', { ...record('original-id', remote), revision: 2, syncState: 'synced' });
        storage.designs.set('conflict-id', { ...record('conflict-id', conflict), revision: 0, syncState: 'conflict' });
        return {
          pushed: 0,
          pulled: 1,
          overwrittenByCloud: ['original-id'],
          conflictCopies: [{ originalId: 'original-id', conflictId: 'conflict-id' }],
          errors: [],
          syncedIds: ['original-id'],
          issues: [],
          cloud: [],
        };
      })
      .mockImplementationOnce(async () => {
        expect(storage.designs.get('conflict-id')?.syncState).toBe('dirty');
        storage.designs.set('conflict-id', {
          ...storage.designs.get('conflict-id')!,
          revision: 1,
          syncState: 'synced',
        });
        return {
          pushed: 1,
          pulled: 0,
          overwrittenByCloud: [],
          conflictCopies: [],
          errors: [],
          syncedIds: ['conflict-id'],
          issues: [],
          cloud: [],
        };
      });

    try {
      render(<Workbench storage={storage} />);
      await screen.findByDisplayValue('本机修改');
      await waitFor(() => expect(enqueueDesignSyncMock).toHaveBeenCalledTimes(1));

      vi.useFakeTimers();
      await act(async () => {
        releaseInitialSync();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByDisplayValue('本机修改 (冲突副本)')).toBeTruthy();
      expect(enqueueDesignSyncMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(enqueueDesignSyncMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText(zhCN.workbench.cloudSynced)).toBeTruthy();
      expect(storage.designs.get('conflict-id')).toMatchObject({ revision: 1, syncState: 'synced' });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      resetAuthStatusCache();
    }
  });

  it('冲突副本切换后同步队列因其他设计失败，不得把副本误标为已同步', async () => {
    window.history.replaceState(null, '', '/app');
    resetAuthStatusCache();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));
    const storage = new FakeStorage();
    const local = savedProject('本机修改', '2026-08-14T12:00:00.000Z');
    const remote = savedProject('云端原件', '2026-08-14T13:00:00.000Z');
    const conflict = { ...local, name: '本机修改 (冲突副本)' };
    storage.designs.set('original-id', record('original-id', local));
    enqueueDesignSyncMock.mockImplementationOnce(async () => {
      storage.designs.set('original-id', { ...record('original-id', remote), revision: 2, syncState: 'synced' });
      storage.designs.set('conflict-id', { ...record('conflict-id', conflict), revision: 0, syncState: 'conflict' });
      return {
        pushed: 0,
        pulled: 1,
        overwrittenByCloud: ['original-id'],
        conflictCopies: [{ originalId: 'original-id', conflictId: 'conflict-id' }],
        errors: ['sibling-id: 云端不可用'],
        syncedIds: ['original-id'],
        issues: [{ designId: 'sibling-id', operation: 'push', code: 'OFFLINE', message: '云端不可用' }],
        cloud: [],
      };
    });

    try {
      render(<Workbench storage={storage} />);
      await screen.findByDisplayValue('本机修改 (冲突副本)');
      await waitFor(() => expect(screen.getAllByRole('status').map((node) => node.textContent)).toContain(zhCN.workbench.cloudPending));
      expect(screen.queryByText(zhCN.workbench.cloudSynced)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      resetAuthStatusCache();
    }
  });

  it('冲突副本合并写入期间的新编辑保留在新 ID，并由自动保存落盘', async () => {
    window.history.replaceState(null, '', '/app');
    resetAuthStatusCache();
    enqueueDesignSyncFacadeMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));

    const storage = new FakeStorage();
    const local = savedProject('本机旧稿', '2026-08-14T12:00:00.000Z');
    const remote = savedProject('云端原件', '2026-08-14T13:00:00.000Z');
    const conflict = { ...local, name: '本机旧稿 (冲突副本)' };
    storage.designs.set('original-id', { ...record('original-id', local), revision: 1, syncState: 'dirty' });

    let deliverOutcome!: () => Promise<void>;
    const outcomeReady = new Promise<void>((resolve) => {
      deliverOutcome = async () => { resolve(); };
    });
    let releaseConflictWrite!: () => void;
    let markConflictWriteStarted!: () => void;
    const conflictWriteStarted = new Promise<void>((resolve) => { markConflictWriteStarted = resolve; });
    const originalPut = storage.put.bind(storage);
    let conflictWriteDelayed = false;
    vi.spyOn(storage, 'put').mockImplementation(async (design, sourceWrite) => {
      if (design.id === 'conflict-id' && !conflictWriteDelayed) {
        conflictWriteDelayed = true;
        markConflictWriteStarted();
        await new Promise<void>((resolve) => { releaseConflictWrite = resolve; });
      }
      await originalPut(design, sourceWrite);
    });
    enqueueDesignSyncFacadeMock.mockImplementationOnce(async (...args: unknown[]) => {
      await outcomeReady;
      storage.designs.set('original-id', { ...record('original-id', remote), revision: 2, syncState: 'synced' });
      storage.designs.set('conflict-id', { ...record('conflict-id', conflict), revision: 0, syncState: 'conflict' });
      const outcome = {
        pushed: 0,
        pulled: 1,
        overwrittenByCloud: ['original-id'],
        conflictCopies: [{ originalId: 'original-id', conflictId: 'conflict-id' }],
        errors: [],
        syncedIds: ['original-id'],
        issues: [],
        cloud: [],
      };
      const onOutcome = args[2] as ((value: unknown) => void | Promise<void>) | undefined;
      if (onOutcome) await onOutcome(outcome);
      return outcome;
    });

    try {
      render(<Workbench storage={storage} />);
      const nameInput = (await screen.findAllByDisplayValue('本机旧稿'))[0] as HTMLInputElement;
      await waitFor(() => expect(enqueueDesignSyncFacadeMock).toHaveBeenCalledTimes(1));

      vi.useFakeTimers();
      fireEvent.change(nameInput, { target: { value: '冲突合并时的编辑' } });
      await act(async () => { await deliverOutcome(); });
      await act(async () => { await conflictWriteStarted; });

      fireEvent.change(nameInput, { target: { value: '写入期间的最新名称' } });
      await act(async () => {
        releaseConflictWrite();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByDisplayValue('写入期间的最新名称')).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(1100);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(storage.designs.get('conflict-id')?.name).toBe('写入期间的最新名称');
      expect(storage.designs.get('original-id')?.name).toBe('云端原件');
    } finally {
      vi.useRealTimers();
      enqueueDesignSyncFacadeMock.mockReset();
      enqueueDesignSyncFacadeMock.mockImplementation(defaultEnqueueDesignSyncMock);
      vi.unstubAllGlobals();
      resetAuthStatusCache();
    }
  });

  it('云端覆盖的冲突副本写入期间导入新项目，迟到结果不得切回旧设计', async () => {
    window.history.replaceState(null, '', '/app');
    resetAuthStatusCache();
    enqueueDesignSyncFacadeMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));

    const storage = new FakeStorage();
    const local = savedProject('本机旧稿', '2026-08-14T12:00:00.000Z');
    const remote = savedProject('云端原件', '2026-08-14T13:00:00.000Z');
    storage.designs.set('original-id', { ...record('original-id', local), revision: 1, syncState: 'dirty' });

    let releaseOutcome!: () => void;
    const outcomeGate = new Promise<void>((resolve) => { releaseOutcome = resolve; });
    let releaseConflictWrite!: () => void;
    let markConflictWriteStarted!: () => void;
    const conflictWriteStarted = new Promise<void>((resolve) => { markConflictWriteStarted = resolve; });
    let createdConflictId: string | null = null;
    const originalPut = storage.put.bind(storage);
    vi.spyOn(storage, 'put').mockImplementation(async (design, sourceWrite) => {
      if (design.id !== 'original-id' && createdConflictId === null) {
        createdConflictId = design.id;
        markConflictWriteStarted();
        await new Promise<void>((resolve) => { releaseConflictWrite = resolve; });
      }
      await originalPut(design, sourceWrite);
    });
    enqueueDesignSyncFacadeMock.mockImplementationOnce(async (...args: unknown[]) => {
      await outcomeGate;
      storage.designs.set('original-id', { ...record('original-id', remote), revision: 2, syncState: 'synced' });
      const outcome = {
        pushed: 0,
        pulled: 1,
        overwrittenByCloud: ['original-id'],
        conflictCopies: [],
        errors: [],
        syncedIds: ['original-id'],
        issues: [],
        cloud: [],
      };
      const onOutcome = args[2] as ((value: unknown) => void | Promise<void>) | undefined;
      if (onOutcome) await onOutcome(outcome);
      return outcome;
    });

    try {
      render(<Workbench storage={storage} />);
      const nameInput = (await screen.findAllByDisplayValue('本机旧稿'))[0] as HTMLInputElement;
      await waitFor(() => expect(enqueueDesignSyncFacadeMock).toHaveBeenCalledTimes(1));
      fireEvent.change(nameInput, { target: { value: '同步捕获的本机编辑' } });

      await act(async () => { releaseOutcome(); });
      await act(async () => { await conflictWriteStarted; });

      const imported = savedProject('新会话项目', '2026-08-15T12:00:00.000Z');
      const file = new File([JSON.stringify(imported)], 'new-session.doupu.json', { type: 'application/json' });
      fireEvent.change(screen.getByLabelText(zhCN.project.importInputLabel), { target: { files: [file] } });
      await screen.findByDisplayValue('新会话项目');

      await act(async () => {
        releaseConflictWrite();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByDisplayValue('新会话项目')).toBeTruthy();
      expect(window.location.search).toBe('');
      expect(createdConflictId).not.toBeNull();
      expect(storage.designs.get(createdConflictId!)?.name).toContain('同步捕获的本机编辑');
    } finally {
      enqueueDesignSyncFacadeMock.mockReset();
      enqueueDesignSyncFacadeMock.mockImplementation(defaultEnqueueDesignSyncMock);
      vi.unstubAllGlobals();
      resetAuthStatusCache();
    }
  });

  it('云端覆盖的冲突副本写入期间继续编辑，保留最新名称并重排自动保存', async () => {
    window.history.replaceState(null, '', '/app');
    resetAuthStatusCache();
    enqueueDesignSyncFacadeMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));

    const storage = new FakeStorage();
    const local = savedProject('本机旧稿', '2026-08-14T12:00:00.000Z');
    const remote = savedProject('云端原件', '2026-08-14T13:00:00.000Z');
    storage.designs.set('original-id', { ...record('original-id', local), revision: 1, syncState: 'dirty' });

    let releaseOutcome!: () => void;
    const outcomeGate = new Promise<void>((resolve) => { releaseOutcome = resolve; });
    let releaseConflictWrite!: () => void;
    let markConflictWriteStarted!: () => void;
    const conflictWriteStarted = new Promise<void>((resolve) => { markConflictWriteStarted = resolve; });
    let createdConflictId: string | null = null;
    const originalPut = storage.put.bind(storage);
    vi.spyOn(storage, 'put').mockImplementation(async (design, sourceWrite) => {
      if (design.id !== 'original-id' && createdConflictId === null) {
        createdConflictId = design.id;
        markConflictWriteStarted();
        await new Promise<void>((resolve) => { releaseConflictWrite = resolve; });
      }
      await originalPut(design, sourceWrite);
    });
    enqueueDesignSyncFacadeMock.mockImplementationOnce(async (...args: unknown[]) => {
      await outcomeGate;
      storage.designs.set('original-id', { ...record('original-id', remote), revision: 2, syncState: 'synced' });
      const outcome = {
        pushed: 0,
        pulled: 1,
        overwrittenByCloud: ['original-id'],
        conflictCopies: [],
        errors: [],
        syncedIds: ['original-id'],
        issues: [],
        cloud: [],
      };
      const onOutcome = args[2] as ((value: unknown) => void | Promise<void>) | undefined;
      if (onOutcome) await onOutcome(outcome);
      return outcome;
    });

    try {
      render(<Workbench storage={storage} />);
      const nameInput = (await screen.findAllByDisplayValue('本机旧稿'))[0] as HTMLInputElement;
      await waitFor(() => expect(enqueueDesignSyncFacadeMock).toHaveBeenCalledTimes(1));

      vi.useFakeTimers();
      fireEvent.change(nameInput, { target: { value: '云端覆盖时的本机编辑' } });
      await act(async () => { releaseOutcome(); });
      await act(async () => { await conflictWriteStarted; });

      fireEvent.change(nameInput, { target: { value: '冲突写入后的最新名称' } });
      await act(async () => {
        releaseConflictWrite();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByDisplayValue('冲突写入后的最新名称')).toBeTruthy();
      expect(createdConflictId).not.toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1100);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(storage.designs.get(createdConflictId!)?.name).toBe('冲突写入后的最新名称');
      expect(storage.designs.get('original-id')?.name).toBe('云端原件');
    } finally {
      vi.useRealTimers();
      enqueueDesignSyncFacadeMock.mockReset();
      enqueueDesignSyncFacadeMock.mockImplementation(defaultEnqueueDesignSyncMock);
      vi.unstubAllGlobals();
      resetAuthStatusCache();
    }
  });

  it('读取云端覆盖结果的本机源期间开始编辑，改为冲突副本而不覆盖 UI', async () => {
    window.history.replaceState(null, '', '/app');
    resetAuthStatusCache();
    enqueueDesignSyncFacadeMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));

    const storage = new FakeStorage();
    const local = savedProject('本机旧稿', '2026-08-14T12:00:00.000Z');
    const remote = savedProject('云端新版', '2026-08-14T13:00:00.000Z');
    storage.designs.set('original-id', { ...record('original-id', local), revision: 1, syncState: 'dirty' });

    let releaseOutcome!: () => void;
    const outcomeGate = new Promise<void>((resolve) => { releaseOutcome = resolve; });
    let delayOutcomeSourceRead = false;
    let releaseSourceRead!: () => void;
    let markSourceReadStarted!: () => void;
    const sourceReadStarted = new Promise<void>((resolve) => { markSourceReadStarted = resolve; });
    const originalGetGenerationSource = storage.getGenerationSource.bind(storage);
    vi.spyOn(storage, 'getGenerationSource').mockImplementation(async (id) => {
      if (delayOutcomeSourceRead && id === 'original-id') {
        delayOutcomeSourceRead = false;
        markSourceReadStarted();
        await new Promise<void>((resolve) => { releaseSourceRead = resolve; });
      }
      return originalGetGenerationSource(id);
    });
    enqueueDesignSyncFacadeMock.mockImplementationOnce(async (...args: unknown[]) => {
      await outcomeGate;
      storage.designs.set('original-id', { ...record('original-id', remote), revision: 2, syncState: 'synced' });
      delayOutcomeSourceRead = true;
      const outcome = {
        pushed: 0,
        pulled: 1,
        overwrittenByCloud: ['original-id'],
        conflictCopies: [],
        errors: [],
        syncedIds: ['original-id'],
        issues: [],
        cloud: [],
      };
      const onOutcome = args[2] as ((value: unknown) => void | Promise<void>) | undefined;
      if (onOutcome) await onOutcome(outcome);
      return outcome;
    });

    try {
      render(<Workbench storage={storage} />);
      const nameInput = (await screen.findAllByDisplayValue('本机旧稿'))[0] as HTMLInputElement;
      await waitFor(() => expect(enqueueDesignSyncFacadeMock).toHaveBeenCalledTimes(1));

      await act(async () => { releaseOutcome(); });
      await act(async () => { await sourceReadStarted; });
      fireEvent.change(nameInput, { target: { value: '源读取期间的新编辑' } });
      await act(async () => {
        releaseSourceRead();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.queryByDisplayValue('云端新版')).toBeNull();
      expect(screen.getByDisplayValue(/源读取期间的新编辑/)).toBeTruthy();
      const conflictRecord = [...storage.designs.values()].find((design) => design.id !== 'original-id');
      expect(conflictRecord?.name).toContain('源读取期间的新编辑');
      expect(storage.designs.get('original-id')?.name).toBe('云端新版');
      expect(window.location.search).toBe(`?id=${conflictRecord?.id}`);
    } finally {
      enqueueDesignSyncFacadeMock.mockReset();
      enqueueDesignSyncFacadeMock.mockImplementation(defaultEnqueueDesignSyncMock);
      vi.unstubAllGlobals();
      resetAuthStatusCache();
    }
  });

  it('读取云端删除结果期间导入新项目，迟到结果不得清空新会话', async () => {
    window.history.replaceState(null, '', '/app');
    resetAuthStatusCache();
    enqueueDesignSyncFacadeMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));

    const storage = new FakeStorage();
    const local = savedProject('即将被云端删除', '2026-08-14T12:00:00.000Z');
    storage.designs.set('original-id', { ...record('original-id', local), revision: 1, syncState: 'synced' });

    let releaseOutcome!: () => void;
    const outcomeGate = new Promise<void>((resolve) => { releaseOutcome = resolve; });
    let delayOutcomeRecordsRead = false;
    let releaseRecordsRead!: () => void;
    let markRecordsReadStarted!: () => void;
    const recordsReadStarted = new Promise<void>((resolve) => { markRecordsReadStarted = resolve; });
    const originalGetAll = storage.getAll.bind(storage);
    vi.spyOn(storage, 'getAll').mockImplementation(async () => {
      if (delayOutcomeRecordsRead) {
        delayOutcomeRecordsRead = false;
        markRecordsReadStarted();
        await new Promise<void>((resolve) => { releaseRecordsRead = resolve; });
      }
      return originalGetAll();
    });
    enqueueDesignSyncFacadeMock.mockImplementationOnce(async (...args: unknown[]) => {
      await outcomeGate;
      storage.designs.delete('original-id');
      delayOutcomeRecordsRead = true;
      const outcome = {
        pushed: 0,
        pulled: 1,
        overwrittenByCloud: ['original-id'],
        conflictCopies: [],
        errors: [],
        syncedIds: [],
        issues: [],
        cloud: [],
      };
      const onOutcome = args[2] as ((value: unknown) => void | Promise<void>) | undefined;
      if (onOutcome) await onOutcome(outcome);
      return outcome;
    });

    try {
      render(<Workbench storage={storage} />);
      await screen.findByDisplayValue('即将被云端删除');
      await waitFor(() => expect(enqueueDesignSyncFacadeMock).toHaveBeenCalledTimes(1));

      await act(async () => { releaseOutcome(); });
      await act(async () => { await recordsReadStarted; });

      const imported = savedProject('新会话项目', '2026-08-15T12:00:00.000Z');
      const file = new File([JSON.stringify(imported)], 'new-session.doupu.json', { type: 'application/json' });
      fireEvent.change(screen.getByLabelText(zhCN.project.importInputLabel), { target: { files: [file] } });
      await screen.findByDisplayValue('新会话项目');

      await act(async () => {
        releaseRecordsRead();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByDisplayValue('新会话项目')).toBeTruthy();
      expect(screen.queryByLabelText(zhCN.upload.inputLabel)).toBeNull();
      expect(window.location.search).toBe('');
    } finally {
      enqueueDesignSyncFacadeMock.mockReset();
      enqueueDesignSyncFacadeMock.mockImplementation(defaultEnqueueDesignSyncMock);
      vi.unstubAllGlobals();
      resetAuthStatusCache();
    }
  });

  it('活动设计被云端新版覆盖后立即刷新工作台，不再保留旧画面和旧 revision', async () => {
    window.history.replaceState(null, '', '/app');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));
    const storage = new FakeStorage();
    storage.designs.set('id-last', record('id-last', savedProject('旧画面', '2026-08-14T12:00:00.000Z')));
    const remoteProject = savedProject('云端新版', '2026-08-14T13:00:00.000Z');
    remoteProject.pattern.cells[0] = { hex: '#FC3D46', code: 'F02', transparent: false };
    enqueueDesignSyncMock.mockImplementation(async () => {
      storage.designs.set('id-last', { ...record('id-last', remoteProject), revision: 2, syncState: 'synced' });
      return { pushed: 0, pulled: 1, overwrittenByCloud: ['id-last'], conflictCopies: [], errors: [], syncedIds: ['id-last'], issues: [], cloud: [] } as never;
    });

    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('云端新版');
    expect(screen.getByText(zhCN.workbench.syncCloudUpdated)).toBeTruthy();
    expect(screen.queryByDisplayValue('旧画面')).toBeNull();
    expect(screen.getByText(zhCN.workbench.sourceRequired)).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('保存等待存储锁期间切到冲突副本，会丢弃旧设计快照并自动重排新设计保存', async () => {
    window.history.replaceState(null, '', '/app');
    resetAuthStatusCache();
    enqueueDesignSyncFacadeMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));

    const storage = new FakeStorage();
    const local = savedProject('本机旧稿', '2026-08-14T12:00:00.000Z');
    const remote = savedProject('云端原件', '2026-08-14T13:00:00.000Z');
    const conflict = { ...local, name: '本机旧稿 (冲突副本)' };
    storage.designs.set('original-id', { ...record('original-id', local), revision: 1, syncState: 'dirty' });

    let deliverInitialSync!: () => Promise<void>;
    const initialSync = new Promise<unknown>((resolve) => {
      deliverInitialSync = async () => {
        storage.designs.set('original-id', { ...record('original-id', remote), revision: 2, syncState: 'synced' });
        storage.designs.set('conflict-id', { ...record('conflict-id', conflict), revision: 0, syncState: 'conflict' });
        resolve({
          pushed: 0,
          pulled: 1,
          overwrittenByCloud: ['original-id'],
          conflictCopies: [{ originalId: 'original-id', conflictId: 'conflict-id' }],
          errors: [],
          syncedIds: ['original-id'],
          issues: [],
          cloud: [],
        });
      };
    });
    enqueueDesignSyncFacadeMock
      .mockImplementationOnce(async (...args: unknown[]) => {
        const outcome = await initialSync;
        const onOutcome = args[2] as ((value: unknown) => void | Promise<void>) | undefined;
        if (onOutcome) await onOutcome(outcome);
        return outcome;
      })
      .mockResolvedValue({
        pushed: 0, pulled: 0, overwrittenByCloud: [], conflictCopies: [], errors: [],
        syncedIds: ['conflict-id'], issues: [], cloud: [],
      });

    let storageRun!: () => Promise<unknown>;
    let markSaveWaiting!: () => void;
    const saveWaiting = new Promise<void>((resolve) => { markSaveWaiting = resolve; });
    let releaseStorageLock!: () => Promise<void>;
    withDesignStorageLockMock
      .mockImplementationOnce((run: () => Promise<unknown>) => {
        storageRun = run;
        markSaveWaiting();
        return new Promise<unknown>((resolve, reject) => {
          releaseStorageLock = async () => {
            try {
              resolve(await storageRun());
            } catch (error) {
              reject(error);
            }
          };
        });
      })
      .mockImplementation((run: () => Promise<unknown>) => run());

    try {
      render(<Workbench storage={storage} />);
      const nameInput = (await screen.findAllByDisplayValue('本机旧稿'))[0] as HTMLInputElement;
      await waitFor(() => expect(enqueueDesignSyncFacadeMock).toHaveBeenCalledTimes(1));

      vi.useFakeTimers();
      fireEvent.change(nameInput, { target: { value: '等待锁期间的新编辑' } });
      await act(async () => {
        vi.advanceTimersByTime(1100);
        await saveWaiting;
      });

      await act(async () => {
        await deliverInitialSync();
        await Promise.resolve();
      });
      expect(screen.getByDisplayValue('等待锁期间的新编辑 (冲突副本)')).toBeTruthy();

      await act(async () => {
        await releaseStorageLock();
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(1100);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(storage.designs.get('original-id')?.name).toBe('云端原件');
      expect(storage.designs.get('conflict-id')?.name).toBe('等待锁期间的新编辑 (冲突副本)');
      expect(enqueueDesignSyncFacadeMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
      enqueueDesignSyncFacadeMock.mockReset();
      enqueueDesignSyncFacadeMock.mockImplementation(defaultEnqueueDesignSyncMock);
      withDesignStorageLockMock.mockReset();
      withDesignStorageLockMock.mockImplementation((run: () => Promise<unknown>) => run());
      vi.unstubAllGlobals();
      resetAuthStatusCache();
    }
  });

  it('旧设计保存令牌失效时，不得覆盖同步回调为冲突副本设置的 dirty 状态', async () => {
    window.history.replaceState(null, '', '/app');
    resetAuthStatusCache();
    enqueueDesignSyncFacadeMock.mockClear();
    const onSavedStatus = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));

    const storage = new FakeStorage();
    const local = savedProject('本机旧稿', '2026-08-14T12:00:00.000Z');
    const remote = savedProject('云端原件', '2026-08-14T13:00:00.000Z');
    storage.designs.set('original-id', { ...record('original-id', local), revision: 1, syncState: 'dirty' });

    let releaseOutcome!: () => void;
    const outcomeGate = new Promise<void>((resolve) => { releaseOutcome = resolve; });
    enqueueDesignSyncFacadeMock.mockImplementationOnce(async (...args: unknown[]) => {
      await outcomeGate;
      storage.designs.set('original-id', { ...record('original-id', remote), revision: 2, syncState: 'synced' });
      const outcome = {
        pushed: 0,
        pulled: 1,
        overwrittenByCloud: ['original-id'],
        conflictCopies: [],
        errors: [],
        syncedIds: ['original-id'],
        issues: [],
        cloud: [],
      };
      const onOutcome = args[2] as ((value: unknown) => void | Promise<void>) | undefined;
      if (onOutcome) await onOutcome(outcome);
      return outcome;
    });

    let storageRun!: () => Promise<unknown>;
    let markSaveWaiting!: () => void;
    const saveWaiting = new Promise<void>((resolve) => { markSaveWaiting = resolve; });
    let releaseStorageLock!: () => Promise<void>;
    withDesignStorageLockMock
      .mockImplementationOnce((run: () => Promise<unknown>) => {
        storageRun = run;
        markSaveWaiting();
        return new Promise<unknown>((resolve, reject) => {
          releaseStorageLock = async () => {
            try {
              resolve(await storageRun());
            } catch (error) {
              reject(error);
            }
          };
        });
      })
      .mockImplementation((run: () => Promise<unknown>) => run());

    try {
      render(<Workbench storage={storage} onSavedStatus={onSavedStatus} />);
      const nameInput = (await screen.findAllByDisplayValue('本机旧稿'))[0] as HTMLInputElement;
      await waitFor(() => expect(enqueueDesignSyncFacadeMock).toHaveBeenCalledTimes(1));
      fireEvent.change(nameInput, { target: { value: '等锁的本机编辑' } });
      fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
      await act(async () => { await saveWaiting; });

      await act(async () => {
        releaseOutcome();
        await Promise.resolve();
        await Promise.resolve();
      });
      await screen.findByDisplayValue('等锁的本机编辑 (冲突副本)');
      await waitFor(() => expect(onSavedStatus.mock.calls.at(-1)?.[0]).toBe('dirty'));

      await act(async () => {
        await releaseStorageLock();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onSavedStatus.mock.calls.at(-1)?.[0]).toBe('dirty');
    } finally {
      enqueueDesignSyncFacadeMock.mockReset();
      enqueueDesignSyncFacadeMock.mockImplementation(defaultEnqueueDesignSyncMock);
      withDesignStorageLockMock.mockReset();
      withDesignStorageLockMock.mockImplementation((run: () => Promise<unknown>) => run());
      vi.unstubAllGlobals();
      resetAuthStatusCache();
    }
  });

  it('后加入同一单飞同步的等待者在部分失败时，从当前设计持久状态保持已同步', async () => {
    window.history.replaceState(null, '', '/app');
    resetAuthStatusCache();
    enqueueDesignSyncFacadeMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return new Response(JSON.stringify({
        generation: { defaultWidth: 100, defaultColorCount: 40 },
        exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
        exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
      }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ email: 'a@b.com', emailVerified: true }), { status: 200 });
      if (url === '/api/palettes') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    }));

    const storage = new FakeStorage();
    const project = savedProject('当前设计', '2026-08-14T12:00:00.000Z');
    storage.designs.set('current-id', { ...record('current-id', project), revision: 0, syncState: 'dirty' });

    let firstOutcomeConsumer: ((value: unknown) => void | Promise<void>) | undefined;
    let rejectSingleFlight!: (error: Error) => void;
    const singleFlight = new Promise<unknown>((_resolve, reject) => { rejectSingleFlight = reject; });
    enqueueDesignSyncFacadeMock.mockImplementation((...args: unknown[]) => {
      if (!firstOutcomeConsumer) {
        firstOutcomeConsumer = args[2] as ((value: unknown) => void | Promise<void>) | undefined;
      }
      return singleFlight;
    });

    try {
      render(<Workbench storage={storage} />);
      await screen.findByDisplayValue('当前设计');
      await waitFor(() => expect(enqueueDesignSyncFacadeMock).toHaveBeenCalledTimes(1));

      act(() => window.dispatchEvent(new Event('online')));
      await waitFor(() => expect(enqueueDesignSyncFacadeMock).toHaveBeenCalledTimes(2));
      expect(enqueueDesignSyncFacadeMock.mock.results[0]?.value)
        .toBe(enqueueDesignSyncFacadeMock.mock.results[1]?.value);

      storage.designs.set('current-id', {
        ...record('current-id', { ...project, updatedAt: '2026-08-14T13:00:00.000Z' }),
        revision: 1,
        syncState: 'synced',
      });
      await act(async () => {
        await firstOutcomeConsumer?.({
          pushed: 1,
          pulled: 0,
          overwrittenByCloud: [],
          conflictCopies: [],
          errors: ['sibling-id: 云端不可用'],
          syncedIds: ['current-id'],
          issues: [{ designId: 'sibling-id', operation: 'push', code: 'OFFLINE', message: '云端不可用' }],
          cloud: [],
        });
        rejectSingleFlight(new Error('同步未完整完成，请稍后重试'));
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.getByText(zhCN.workbench.cloudSynced)).toBeTruthy());
      expect(screen.queryByText(zhCN.workbench.cloudPending)).toBeNull();
    } finally {
      enqueueDesignSyncFacadeMock.mockReset();
      enqueueDesignSyncFacadeMock.mockImplementation(defaultEnqueueDesignSyncMock);
      vi.unstubAllGlobals();
      resetAuthStatusCache();
    }
  });
});
