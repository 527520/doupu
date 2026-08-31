// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Blob as NodeBlob } from 'node:buffer';
import PngExportButton from './PngExportButton';
import type { Pattern, PatternCell } from '@/lib/types';

const cell = (hex: string, code = 'A01'): PatternCell => ({ hex, code, transparent: false });
const transparent: PatternCell = { hex: null, code: null, transparent: true };

function makePattern(w: number, h: number, cells: PatternCell[]): Pattern {
  return { width: w, height: h, cells };
}

describe('PngExportButton（优化票 10：选项面板）', () => {
  beforeEach(() => {
    // jsdom 无 toBlob / createObjectURL
    HTMLCanvasElement.prototype.toBlob = function toBlob(
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(new Blob(['png-bytes'], { type: 'image/png' }));
    };
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    // 站点配置钩子的 /api/config 请求：保持挂起（本组用例用回退默认值），
    // 避免测试结束后配置 setState 触发 act 告警
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('空图纸（全透明）→ 按钮禁用（E10）', () => {
    const p = makePattern(2, 2, [transparent, transparent, transparent, transparent]);
    render(<PngExportButton pattern={p} designName="设计" />);
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  });

  it('全外部图纸 → 按钮禁用（E24）', () => {
    const p = makePattern(2, 2, [
      { hex: '#000000', code: 'A', transparent: false, external: true },
      { hex: '#000000', code: 'A', transparent: false, external: true },
      { hex: '#000000', code: 'A', transparent: false, external: true },
      { hex: '#000000', code: 'A', transparent: false, external: true },
    ]);
    render(<PngExportButton pattern={p} designName="设计" />);
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  });

  it('点击导出先打开选项面板；确认后触发下载并释放 objectURL', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    let delayedRevoke: (() => void) | null = null;
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 1_500 && typeof handler === 'function') {
        delayedRevoke = () => handler(...args);
        return 1;
      }
      return originalSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const p = makePattern(2, 1, [cell('#000000', 'A01'), cell('#FFFFFF', 'T01')]);
    render(<PngExportButton pattern={p} designName="我的设计" />);
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG 图纸' }));
    // 面板出现，尚未下载
    expect(screen.getByRole('region', { name: 'PNG 导出选项' })).toBeTruthy();
    expect(clickSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
    // 等面板关闭与 busy 复位（finally 阶段），避免悬空更新
    await waitFor(() => expect(screen.queryByRole('region', { name: 'PNG 导出选项' })).toBeNull());
    expect((URL.createObjectURL as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1_500);
    expect((URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(delayedRevoke).not.toBeNull();
    (delayedRevoke as unknown as () => void)();
    expect((URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('blob:mock-url');
    clickSpy.mockRestore();
  });

  it('选项：修改格子大小/裁边/图例并确认导出', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const p = makePattern(2, 1, [cell('#000000', 'A01'), cell('#FFFFFF', 'T01')]);
    render(<PngExportButton pattern={p} designName="设计" />);
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG 图纸' }));
    fireEvent.change(screen.getByLabelText('格子大小'), { target: { value: '48' } });
    fireEvent.click(screen.getByLabelText('裁掉图纸边缘空白'));
    fireEvent.click(screen.getByLabelText('包含图例与色号清单'));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'PNG 导出选项' })).toBeNull());
    clickSpy.mockRestore();
  });

  it('取消关闭面板且不下载', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const p = makePattern(1, 1, [cell('#000000')]);
    render(<PngExportButton pattern={p} designName="设计" />);
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG 图纸' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('region', { name: 'PNG 导出选项' })).toBeNull();
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('toBlob 返回 null → 显示失败文案且不下载', async () => {
    HTMLCanvasElement.prototype.toBlob = function toBlob(
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(null);
    };
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const p = makePattern(1, 1, [cell('#000000')]);
    render(<PngExportButton pattern={p} designName="设计" />);
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG 图纸' }));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('导出失败，请重试。');
    });
    // 等 busy 复位
    await waitFor(() => expect(screen.getByRole('button', { name: '导出 PNG 图纸' })).toBeEnabled());
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('文件名写入 anchor.download（含非法字符清洗）', async () => {
    let downloadName = '';
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      downloadName = this.download;
    };
    const p = makePattern(2, 2, [cell('#000000'), cell('#000000'), cell('#000000'), cell('#000000')]);
    render(<PngExportButton pattern={p} designName="a/b" />);
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG 图纸' }));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => {
      expect(downloadName).toBe('豆谱-a-b-2x2.png');
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'PNG 导出选项' })).toBeNull());
    HTMLAnchorElement.prototype.click = origClick;
  });

  it('合并超限但两张分别可导出时，动态打包为只含图纸与图例的 ZIP', async () => {
    // jsdom 的旧 Blob 缺少 stream()；真实浏览器具备该 API，测试改用 Node 的 WHATWG Blob。
    vi.stubGlobal('Blob', NodeBlob);
    let downloadName = '';
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      downloadName = this.download;
    };
    (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mockReturnValue('blob:zip-url');
    const p: Pattern = {
      width: 170,
      height: 170,
      cells: Array.from({ length: 170 * 170 }, (_, index) => {
        const color = index % 500;
        return cell(
          `#${(color + 1).toString(16).padStart(6, '0')}`,
          `LONG-COLOR-${color.toString().padStart(9, '0')}`,
        );
      }),
    };
    render(<PngExportButton pattern={p} designName="极限" />);
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG 图纸' }));
    fireEvent.change(screen.getByLabelText('格子大小'), { target: { value: '24' } });
    fireEvent.click(screen.getByLabelText('包含图例与色号清单'));

    expect(screen.getByRole('status').textContent).toContain('打包为两张 PNG');
    fireEvent.click(screen.getByRole('button', { name: '导出' }));

    await waitFor(() => expect(downloadName).toBe('豆谱-极限-170x170-PNG.zip'));
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/zip' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'PNG 导出选项' })).toBeNull());
    HTMLAnchorElement.prototype.click = origClick;
  }, 15_000);
});
