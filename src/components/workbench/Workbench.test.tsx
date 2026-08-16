// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Workbench from './Workbench';
import type { DecodedImage, DecodeResult } from '@/lib/image/decode';
import type { DesignRecord, StorageAdapter } from '@/lib/storage';
import type { ProjectFile } from '@/lib/types';
import { zhCN } from '@/messages/zh-CN';

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

function savedProject(name: string, updatedAt: string): ProjectFile {
  return {
    format: 'doupu-project',
    version: 1,
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
  it('上传→裁剪→工作台：默认 100×100 生成，参数面板改宽度 20 后重生成 400 粒', async () => {
    const storage = new FakeStorage();
    render(<Workbench storage={storage} decodeFn={fakeDecode} />);
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
    await renderRestored(storage);
    fireEvent.click(screen.getByText(zhCN.workbench.save));
    await waitFor(() => expect(screen.getByText(zhCN.workbench.saved)).toBeTruthy(), { timeout: 3000 });
    expect(storage.designs.size).toBe(1);
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
  it('登录后加载云端色板进下拉，选中后按自定义色板重新生成', async () => {
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
        return new Response(JSON.stringify([
          { id: 'pal-1', name: '粉彩', colors: [{ hex: '#FFAA00', code: 'P1' }], updatedAt: '2026-08-15T00:00:00.000Z' },
          { id: 'pal-2', name: '空板', colors: [], updatedAt: '2026-08-15T00:00:00.000Z' },
        ]), { status: 200 });
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

    // 选中自定义色板 → 头部显示「自定义色板」
    fireEvent.change(select, { target: { value: 'custom:pal-1' } });
    expect(screen.getByText(zhCN.workbench.customPaletteLabel)).toBeTruthy();

    vi.unstubAllGlobals();
  });
});
