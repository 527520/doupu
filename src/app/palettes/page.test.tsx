// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PalettesPage from './page';
import { zhCN } from '@/messages/zh-CN';
import type { PaletteRecord } from '@/components/palettes/api';

const t = zhCN.palettes;

const listPalettes = vi.fn();
const savePalette = vi.fn();
const deletePalette = vi.fn();
const newPaletteId = vi.fn(() => '00000000-0000-4000-8000-000000000001');
const mockPush = vi.fn();

vi.mock('@/components/palettes/api', () => ({
  listPalettes: (...args: unknown[]) => listPalettes(...args),
  savePalette: (...args: unknown[]) => savePalette(...args),
  deletePalette: (...args: unknown[]) => deletePalette(...args),
  newPaletteId: () => newPaletteId(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const record = (id: string, name: string): PaletteRecord => ({
  id,
  name,
  colors: [{ code: 'A', hex: '#FF0000' }],
  updatedAt: '2026-08-14T00:00:00.000Z',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PalettesPage', () => {
  it('加载列表：渲染内置五品牌（各 291 色）与自定义色板卡片', async () => {
    listPalettes.mockResolvedValue([record('id-1', '我的色板')]);
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText('我的色板')).toBeTruthy());
    for (const brand of ['MARD', 'COCO', '漫漫', '盼盼', '咪小窝']) {
      expect(screen.getByText(brand)).toBeTruthy();
    }
    expect(screen.getAllByText(t.colorCount(291))).toHaveLength(5);
    // 自定义卡片文案为「1 色 · 日期」；用带分隔符的正则避免误匹配「291 色」
    expect(screen.getByText(/1 色 · /)).toBeTruthy();
  });

  it('空态：无自定义色板时显示提示', async () => {
    listPalettes.mockResolvedValue([]);
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText(t.empty)).toBeTruthy());
  });

  it('加载失败：显示错误与重试按钮，点击重试重新加载', async () => {
    listPalettes.mockRejectedValueOnce(new Error('boom'));
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText(t.loadFailed)).toBeTruthy());
    listPalettes.mockResolvedValueOnce([record('id-2', '恢复')]);
    fireEvent.click(screen.getByRole('button', { name: t.retry }));
    await waitFor(() => expect(screen.getByText('恢复')).toBeTruthy());
    expect(listPalettes).toHaveBeenCalledTimes(2);
  });

  it('未登录（401）：显示登录提示', async () => {
    const error = new Error('未登录') as Error & { code: string };
    error.code = 'UNAUTHORIZED';
    listPalettes.mockRejectedValueOnce(error);
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText(t.loginRequired)).toBeTruthy());
  });

  it('新建：打开编辑器，保存成功后写入列表并关闭', async () => {
    listPalettes.mockResolvedValue([]);
    savePalette.mockResolvedValue(record('id-new', '新建板'));
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText(t.empty)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: t.newPalette }));
    expect(screen.getByLabelText(t.editor.title)).toBeTruthy();
    // 弹窗宽度（桌面不应过宽：max-w-lg = 512px）
    expect(screen.getByRole('dialog', { name: t.edit })).toHaveClass('max-w-lg');

    fireEvent.change(screen.getByLabelText(t.editor.name), { target: { value: '新建板' } });
    // 编辑器默认一行 C001/#FFFFFF，直接保存
    fireEvent.click(screen.getByRole('button', { name: t.editor.save }));
    await waitFor(() => expect(savePalette).toHaveBeenCalledTimes(1));
    expect(savePalette).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', '新建板', [
      { code: 'C001', hex: '#FFFFFF' },
    ]);
    await waitFor(() => expect(screen.getByText('新建板')).toBeTruthy());
    expect(screen.queryByLabelText(t.editor.title)).toBeNull();
  });

  it('删除：确认后调用 API 并从列表移除；取消则不调用', async () => {
    listPalettes.mockResolvedValue([record('id-1', '待删')]);
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText('待删')).toBeTruthy());

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: t.delete }));
    expect(deletePalette).not.toHaveBeenCalled();
    confirmSpy.mockReturnValue(true);
    deletePalette.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: t.delete }));
    await waitFor(() => expect(deletePalette).toHaveBeenCalledWith('id-1'));
    await waitFor(() => expect(screen.queryByText('待删')).toBeNull());
    confirmSpy.mockRestore();
  });

  it('编辑：打开编辑器并预填数据', async () => {
    listPalettes.mockResolvedValue([record('id-1', '要编辑')]);
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText('要编辑')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: t.edit }));
    expect((screen.getByLabelText(t.editor.name) as HTMLInputElement).value).toBe('要编辑');
    expect((screen.getByLabelText(`${t.editor.code} 1`) as HTMLInputElement).value).toBe('A');
  });

  it('游客点「新建色板」：跳登录页（带回跳），不打开弹窗', async () => {
    const error = new Error('未登录') as Error & { code: string };
    error.code = 'UNAUTHORIZED';
    listPalettes.mockRejectedValueOnce(error);
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText(t.loginRequired)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: t.newPalette }));

    expect(mockPush).toHaveBeenCalledWith('/login?next=/palettes');
    expect(screen.queryByLabelText(t.editor.title)).toBeNull();
  });

  it('会话中途失效：保存返回 UNAUTHORIZED → 关闭弹窗并跳登录', async () => {
    listPalettes.mockResolvedValue([]);
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText(t.empty)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: t.newPalette }));
    fireEvent.change(screen.getByLabelText(t.editor.name), { target: { value: '我的色板' } });
    const error = new Error('未登录') as Error & { code: string };
    error.code = 'UNAUTHORIZED';
    savePalette.mockRejectedValueOnce(error);
    fireEvent.click(screen.getByRole('button', { name: t.editor.save }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login?next=/palettes'));
    expect(screen.queryByLabelText(t.editor.title)).toBeNull();
  });
});
