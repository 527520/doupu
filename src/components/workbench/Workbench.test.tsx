// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Workbench from './Workbench';
import type { DecodedImage, DecodeResult, ImageDecoder } from '@/lib/image/decode';
import type { DesignRecord, StorageAdapter } from '@/lib/storage';
import type { ProjectFile } from '@/lib/types';
import { zhCN } from '@/messages/zh-CN';
import { runGenerate, type GenerateTask } from '@/lib/engine/runGenerate';

const { pushMock, enqueueDesignSyncMock, createDoupuApiMock, cloudApiStub } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  enqueueDesignSyncMock: vi.fn(async () => undefined),
  createDoupuApiMock: vi.fn(),
  cloudApiStub: {},
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('@/lib/sync/api', () => ({
  createDoupuApi: createDoupuApiMock.mockReturnValue(cloudApiStub),
}));
vi.mock('@/lib/sync/queue', () => ({
  enqueueDesignSync: async (...args: unknown[]) => {
    const outcome = await enqueueDesignSyncMock();
    const onOutcome = args[2] as ((value: unknown) => void | Promise<void>) | undefined;
    if (outcome && onOutcome) await onOutcome(outcome);
    return outcome;
  },
  withDesignStorageLock: <T,>(run: () => Promise<T>) => run(),
}));

/** 内存版存储假实现（测试专用）。 */
class FakeStorage implements StorageAdapter {
  readonly designs = new Map<string, DesignRecord>();
  quotaExceeded = false;
  async getAll(): Promise<DesignRecord[]> {
    return [...this.designs.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  async put(record: DesignRecord): Promise<void> {
    if (this.quotaExceeded) throw new DOMException('quota', 'QuotaExceededError');
    this.designs.set(record.id, { ...record });
  }
  async delete(id: string): Promise<void> {
    this.designs.delete(id);
  }
  async getMeta(): Promise<string | null> {
    return null;
  }
  async setMeta(): Promise<void> {
    // no-op
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
    version: 2,
    engineVersion: '2.0.0',
    name,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt,
    palette: { kind: 'builtin', brand: 'MARD' },
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

/** 常见准备：预置一个已保存设计并渲染，等待恢复完成（真实计时器阶段）。 */
async function renderRestored(storage: FakeStorage): Promise<HTMLInputElement> {
  storage.designs.set('id-last', record('id-last', savedProject('初始', '2026-08-14T12:00:00.000Z')));
  render(<Workbench storage={storage} />);
  return (await screen.findByDisplayValue('初始')) as HTMLInputElement;
}

describe('Workbench 全流程', () => {
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
    await screen.findByText(zhCN.crop.title);
    fireEvent.click(screen.getByText(zhCN.crop.useWholeImage));
    await screen.findByText(/共 10000 粒/);

    expect(decoder.load).toHaveBeenCalledOnce();
    expect(decoder.region).toHaveBeenCalledWith(
      { x: 0, y: 0, width: 8, height: 8 },
      800,
    );
    unmount();
    expect(decoder.dispose).not.toHaveBeenCalled();
  });

  it('上传→裁剪→工作台：默认 100×100 生成，参数面板改宽度 20 后重生成 400 粒', async () => {
    const storage = new FakeStorage();
    render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={instantGenerate} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });

    // 裁剪步骤出现
    await screen.findByText(zhCN.crop.title);
    fireEvent.click(screen.getByText(zhCN.crop.useWholeImage));

    // 工作台：默认 targetWidth=100 → 8×8 图 → 100×100 = 10000 粒
    await screen.findByText(/共 10000 粒/);
    expect(screen.getByText(zhCN.workbench.previewTab)).toBeTruthy();
    expect(screen.getByText(zhCN.workbench.editTab)).toBeTruthy();
    expect(screen.getByText(zhCN.export.pngExport)).toBeTruthy();

    // 参数面板接线：宽度输入 20 → blur 提交 → 300ms 防抖 → 重生成 20×20 = 400 粒
    const widthInput = screen.getByRole('spinbutton', { name: zhCN.params.targetWidth }) as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '20' } });
    fireEvent.blur(widthInput);
    await waitFor(() => expect(screen.getByText(/共 400 粒/)).toBeTruthy(), { timeout: 5000 });
  });

  it('手工修补后重生成需确认，取消会回滚参数，确认后可恢复修补快照', async () => {
    const storage = new FakeStorage();
    render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={instantGenerate} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await screen.findByText(zhCN.crop.title);
    fireEvent.click(screen.getByText(zhCN.crop.useWholeImage));
    await screen.findByText(/共 10000 粒/);

    fireEvent.click(screen.getByText(zhCN.workbench.editTab));
    const canvas = screen.getByLabelText(zhCN.editor.canvasAria);
    fireEvent.pointerDown(canvas, { clientX: 1, clientY: 1, pointerType: 'mouse', pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 1, clientY: 1, pointerType: 'mouse', pointerId: 1 });

    const confirmSpy = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const widthInput = screen.getByRole('spinbutton', { name: zhCN.params.targetWidth }) as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '20' } });
    fireEvent.blur(widthInput);
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(widthInput.value).toBe('100'));
    expect(screen.getByText(/共 10000 粒/)).toBeTruthy();

    fireEvent.change(widthInput, { target: { value: '20' } });
    fireEvent.blur(widthInput);
    await waitFor(() => expect(screen.getByText(/共 400 粒/)).toBeTruthy(), { timeout: 5000 });
    fireEvent.click(screen.getByText(zhCN.workbench.undoRegeneration));
    await waitFor(() => expect(screen.getByText(/共 10000 粒/)).toBeTruthy());
    expect(screen.queryByText(zhCN.workbench.undoRegeneration)).toBeNull();
    confirmSpy.mockRestore();
  });

  it('重新生成失败会回滚参数控件并保留上一份已提交图纸', async () => {
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
    render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={generateFn} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await screen.findByText(zhCN.crop.title);
    fireEvent.click(screen.getByText(zhCN.crop.useWholeImage));
    await screen.findByText(/共 10000 粒/);

    const widthInput = screen.getByRole('spinbutton', { name: zhCN.params.targetWidth }) as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '20' } });
    fireEvent.blur(widthInput);

    await screen.findByText(zhCN.workbench.generateFailed);
    await waitFor(() => expect(
      (screen.getByRole('spinbutton', { name: zhCN.params.targetWidth }) as HTMLInputElement).value,
    ).toBe('100'));
    expect(screen.getByText(/共 10000 粒/)).toBeTruthy();
    expect(screen.queryByText(/共 400 粒/)).toBeNull();
  });

  it('首次生成取消后返回可重新上传状态，不留下空白工作台', async () => {
    const cancel = vi.fn();
    const generateFn: typeof runGenerate = () => ({
      promise: new Promise(() => undefined),
      cancel,
    });
    render(<Workbench storage={new FakeStorage()} decodeFn={fakeDecode} generateFn={generateFn} />);
    fireEvent.change(selectUploadInput(), { target: { files: [makeFile()] } });
    await screen.findByText(zhCN.crop.title);
    fireEvent.click(screen.getByText(zhCN.crop.useWholeImage));
    fireEvent.click(await screen.findByRole('button', { name: zhCN.workbench.cancel }));

    expect(cancel).toHaveBeenCalledOnce();
    expect(await screen.findByLabelText(zhCN.upload.inputLabel)).toBeTruthy();
    expect(screen.queryByText(zhCN.workbench.previewTab)).toBeNull();
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

describe('Workbench 本地保存', () => {
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
    const confirmSpy = vi.spyOn(window, 'confirm');
    fireEvent.change(nameInput, { target: { value: '离开前保存' } });
    fireEvent.click(screen.getAllByRole('link', { name: zhCN.nav.designs })[0]);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/designs'));
    expect([...storage.designs.values()][0].name).toBe('离开前保存');
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('重新上传保存失败时只在用户确认后才离开工作台', async () => {
    const storage = new FakeStorage();
    const nameInput = await renderRestored(storage);
    storage.quotaExceeded = true;
    fireEvent.change(nameInput, { target: { value: '未保存名称' } });
    const confirmSpy = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.restart }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByText(zhCN.workbench.previewTab)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.restart }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2));
    await screen.findByLabelText(zhCN.upload.inputLabel);
    confirmSpy.mockRestore();
  });

  it('恢复项目重新上传原图后保留当前设计身份并解锁重生成', async () => {
    window.history.replaceState(null, '', '/app?id=id-last');
    const storage = new FakeStorage();
    const original = savedProject('保留身份', '2026-08-14T12:00:00.000Z');
    storage.designs.set('id-last', record('id-last', original));
    render(<Workbench storage={storage} decodeFn={fakeDecode} generateFn={instantGenerate} />);
    await screen.findByDisplayValue('保留身份');
    expect(screen.getByRole('spinbutton', { name: zhCN.params.targetWidth })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.restart }));
    fireEvent.change(await screen.findByLabelText(zhCN.upload.inputLabel), { target: { files: [makeFile()] } });
    await screen.findByText(zhCN.crop.title);
    fireEvent.click(screen.getByText(zhCN.crop.useWholeImage));

    await waitFor(() => expect(screen.getByRole('spinbutton', { name: zhCN.params.targetWidth })).not.toBeDisabled());
    expect(screen.getByDisplayValue('保留身份')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: zhCN.workbench.save }));
    await waitFor(() => expect(storage.designs.get('id-last')?.name).toBe('保留身份'));
    expect(storage.designs.size).toBe(1);
    expect(JSON.parse(storage.designs.get('id-last')!.projectJson).createdAt).toBe(original.createdAt);
    expect(window.location.search).toBe('?id=id-last');
  });
});

describe('Workbench 编辑与导出接缝', () => {
  it('编辑模式落笔后 onPatternChange 触发自动保存', async () => {
    const storage = new FakeStorage();
    await renderRestored(storage);
    fireEvent.click(screen.getByText(zhCN.workbench.editTab));
    const canvas = screen.getByLabelText(zhCN.editor.canvasAria);

    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerType: 'mouse' });
      fireEvent.pointerUp(canvas, { clientX: 0, clientY: 0, pointerType: 'mouse' });
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
  it('恢复项目仍加载云端色板，但没有原图时锁定重生成控件', async () => {
    enqueueDesignSyncMock.mockResolvedValue({
      pushed: 0,
      pulled: 0,
      overwrittenByCloud: [],
      conflictCopies: [],
      errors: [],
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
            { id: 'pal-1', name: '粉彩', colors: [{ hex: '#FFAA00', code: 'P1' }], updatedAt: '2026-08-15T00:00:00.000Z', revision: 1 },
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

    // 下拉出现「我的·粉彩」；空色板被过滤
    const select = (await screen.findByLabelText(zhCN.params.brand)) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.textContent).toContain('我的·粉彩');
      expect(select.textContent).not.toContain('空板');
    });

    // 项目文件不含原图：选项可见但控件锁定，不能让色板声明与旧图纸失配。
    expect(select).toBeDisabled();
    expect(screen.getByText(zhCN.workbench.sourceRequired)).toBeTruthy();
    fireEvent.change(select, { target: { value: 'custom:pal-1' } });
    expect(select.value).toBe('MARD');

    await waitFor(() => expect(screen.getByText(zhCN.workbench.cloudSynced)).toBeTruthy());
    const callsBeforeOnline = enqueueDesignSyncMock.mock.calls.length;
    window.dispatchEvent(new Event('online'));
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
          cloud: [],
        } as never;
      })
      .mockResolvedValue({ pushed: 0, pulled: 0, overwrittenByCloud: [], conflictCopies: [], errors: [], cloud: [] } as never);

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
    remoteProject.pattern.cells[0] = { hex: '#FF0000', code: 'F02', transparent: false };
    enqueueDesignSyncMock.mockImplementation(async () => {
      storage.designs.set('id-last', { ...record('id-last', remoteProject), revision: 2, syncState: 'synced' });
      return { pushed: 0, pulled: 1, overwrittenByCloud: ['id-last'], conflictCopies: [], errors: [], cloud: [] } as never;
    });

    render(<Workbench storage={storage} />);
    await screen.findByDisplayValue('云端新版');
    expect(screen.getByText(zhCN.workbench.syncCloudUpdated)).toBeTruthy();
    expect(screen.queryByDisplayValue('旧画面')).toBeNull();
    expect(screen.getByText(zhCN.workbench.sourceRequired)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
