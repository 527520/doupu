// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PngExportButton from './PngExportButton';
import type { Pattern, PatternCell } from '@/lib/types';

const cell = (hex: string, code = 'A01'): PatternCell => ({ hex, code, transparent: false });
const transparent: PatternCell = { hex: null, code: null, transparent: true };

function makePattern(w: number, h: number, cells: PatternCell[]): Pattern {
  return { width: w, height: h, cells };
}

describe('PngExportButton', () => {
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

  it('非空图纸点击 → 触发下载（objectURL + anchor 点击 + 释放）', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const p = makePattern(2, 1, [cell('#000000', 'A01'), cell('#FFFFFF', 'T01')]);
    render(<PngExportButton pattern={p} designName="我的设计" />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
    expect((URL.createObjectURL as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('blob:mock-url');
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
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('导出失败，请重试。');
    });
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
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(downloadName).toBe('豆谱-a-b-2x2.png');
    });
    HTMLAnchorElement.prototype.click = origClick;
  });
});
