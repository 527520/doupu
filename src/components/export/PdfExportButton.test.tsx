// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PdfExportButton from './PdfExportButton';
import type { Pattern, PatternStatsItem } from '@/lib/types';

const pattern: Pattern = {
  width: 2,
  height: 2,
  cells: [
    { hex: '#000000', code: 'A01', transparent: false },
    { hex: '#FFFFFF', code: 'A02', transparent: false },
    { hex: '#FF0000', code: 'A03', transparent: false },
    { hex: null, code: null, transparent: true },
  ],
};

const emptyPattern: Pattern = {
  width: 2,
  height: 2,
  cells: [
    { hex: null, code: null, transparent: true },
    { hex: null, code: null, transparent: true },
    { hex: null, code: null, transparent: true },
    { hex: null, code: null, transparent: true },
  ],
};

const stats: PatternStatsItem[] = [
  { code: 'A02', hex: '#FFFFFF', count: 1 },
  { code: 'A01', hex: '#000000', count: 1 },
  { code: 'A03', hex: '#FF0000', count: 1 },
];

function setup(over: { name?: string; pattern?: Pattern; stats?: PatternStatsItem[] } = {}) {
  render(
    <PdfExportButton
      name={over.name ?? '测试'}
      pattern={over.pattern ?? pattern}
      stats={over.stats ?? stats}
    />,
  );
}

describe('PdfExportButton', () => {
  it('渲染导出按钮', () => {
    setup();
    expect(screen.getByRole('button', { name: '导出 PDF' })).toBeTruthy();
  });

  it('空图纸（全透明）不打开对话框并显示错误', () => {
    setup({ pattern: emptyPattern });
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }));
    expect(screen.queryByRole('region', { name: '确认导出 PDF' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('图纸为空，无法导出');
  });

  it('正常图纸打开确认框并显示页数（2×2 → 图纸 1 页 + 清单 1 页）', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }));
    const dialog = screen.getByRole('region', { name: '确认导出 PDF' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText('共 2 页：图纸 1 页 + 图例清单 1 页')).toBeTruthy();
  });

  it('500 色图例分页时预览页数与实际分页一致', () => {
    const manyStats = Array.from({ length: 500 }, (_, index) => ({
      code: `C${index}`,
      hex: `#${index.toString(16).padStart(6, '0')}`,
      count: 1,
    }));
    setup({ stats: manyStats });
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }));
    expect(screen.getByText('共 3 页：图纸 1 页 + 图例清单 2 页')).toBeTruthy();
  });

  it('确认后生成并下载 PDF（文件名规则 + 内容为 %PDF）', async () => {
    // 替换 URL.createObjectURL（jsdom 未实现）并拦截真实下载
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<PdfExportButton name="我的设计" pattern={pattern} stats={stats} />);
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    const anchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('豆谱-我的设计-2x2.pdf');
    expect(anchor.href).toBe('blob:mock');
    // 生成内容为真实 PDF（%PDF 头）
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header = String.fromCharCode(...bytes.subarray(0, 5));
    expect(header).toBe('%PDF-');
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock'), { timeout: 2500 });
    clickSpy.mockRestore();
  });

  it('取消关闭对话框且不下载', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
