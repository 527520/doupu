// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PalettesPage from './page';
import { zhCN } from '@/messages/zh-CN';
import type { PaletteRecord } from '@/components/palettes/api';
import { getBuiltinPalette, listBuiltinPalettes } from '@/lib/palettes';
import { compatibleBoardProfilesForPalette } from '@/lib/boardProfiles';

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
  revision: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PalettesPage', () => {
  it('加载中提供明确的 live region 反馈', () => {
    listPalettes.mockReturnValue(new Promise(() => {}));
    render(<PalettesPage />);
    expect(screen.getByText(t.loading)).toHaveAttribute('role', 'status');
  });

  it('加载列表：按品牌分组渲染 13 套内置色板与自定义色板', async () => {
    listPalettes.mockResolvedValue([record('id-1', '我的色板')]);
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText('我的色板')).toBeTruthy());
    const library = screen.getByRole('region', { name: t.builtinTitle });
    expect(within(library).getAllByRole('listitem')).toHaveLength(13);
    expect(library.querySelectorAll('.palette-brand-group')).toHaveLength(6);
    expect(within(library).getAllByText(t.collectedColors)).toHaveLength(13);
    expect(within(library).getAllByText(t.engineColors)).toHaveLength(13);
    // 自定义卡片文案为「1 色 · 日期」；用带分隔符的正则避免误匹配「291 色」
    expect(screen.getByText(/1 色 · /)).toBeTruthy();
  });

  it('内置色板可按品牌、系列和规格搜索，并实时播报结果数', async () => {
    listPalettes.mockResolvedValue([]);
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText(t.empty)).toBeTruthy());
    const search = screen.getByRole('searchbox', { name: t.searchLabel });
    fireEvent.change(search, { target: { value: 'Mini C' } });
    const library = screen.getByRole('region', { name: t.builtinTitle });
    expect(within(library).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(t.searchResults(1, 13));

    fireEvent.change(search, { target: { value: '2.6mm / 52×52' } });
    expect(within(library).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveTextContent(t.searchResults(3, 13));

    fireEvent.change(search, { target: { value: '不存在的品牌' } });
    expect(within(library).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(library).getByText(t.noSearchResults)).toBeTruthy();
  });

  it('卡片展示收录/可生成数、规格、来源质量与透明排除项', async () => {
    listPalettes.mockResolvedValue([]);
    const summary = listBuiltinPalettes().find((palette) => palette.series === 'C 系列 197 色');
    expect(summary).toBeTruthy();
    const palette = getBuiltinPalette(summary!.id);
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText(t.empty)).toBeTruthy());
    const heading = screen.getByRole('heading', { name: palette.series });
    const card = heading.closest('li');
    expect(card).toHaveTextContent(t.colorCount(palette.colorCount));
    expect(card).toHaveTextContent(t.colorCount(palette.engineColorCount));
    for (const profile of compatibleBoardProfilesForPalette({ kind: 'builtin', brand: palette.id })) {
      expect(card).toHaveTextContent(profile.displayName);
    }
    expect(card).toHaveTextContent(palette.source.qualityLabel);
    expect(card).toHaveTextContent(t.exclusionTransparent(palette.exclusions.transparent));
  });

  it('MARD 221 展示领域规则允许的全部三种制作规格', async () => {
    listPalettes.mockResolvedValue([]);
    const summary = listBuiltinPalettes().find((palette) => palette.series === '221 色核对版');
    expect(summary).toBeTruthy();
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText(t.empty)).toBeTruthy());
    const card = screen.getByRole('heading', { name: summary!.series }).closest('li');
    expect(card).toHaveTextContent('5mm / 29×29');
    expect(card).toHaveTextContent('2.6mm / 50×50');
    expect(card).toHaveTextContent('2.6mm / 52×52');
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
    // 弹窗宽度（max-w-xl = 576px：容纳取色器 + 色号 + 删除列与整行校验错误，不折行）
    expect(screen.getByRole('dialog', { name: t.edit })).toHaveClass('max-w-xl');

    fireEvent.change(screen.getByLabelText(t.editor.name), { target: { value: '新建板' } });
    // 编辑器默认一行 C001/#FFFFFF，直接保存
    fireEvent.click(screen.getByRole('button', { name: t.editor.save }));
    await waitFor(() => expect(savePalette).toHaveBeenCalledTimes(1));
    expect(savePalette).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', '新建板', [
      { code: 'C001', hex: '#FFFFFF' },
    ], 0);
    await waitFor(() => expect(screen.getByText('新建板')).toBeTruthy());
    expect(screen.queryByLabelText(t.editor.title)).toBeNull();
  });

  it('删除：确认后调用 API 并从列表移除；取消则不调用', async () => {
    listPalettes.mockResolvedValue([record('id-1', '待删')]);
    render(<PalettesPage />);
    await waitFor(() => expect(screen.getByText('待删')).toBeTruthy());

    const cancelDelete = async (): Promise<void> => {
      fireEvent.click(screen.getByRole('button', { name: t.delete }));
      fireEvent.click(await screen.findByRole('button', { name: zhCN.common.cancel }));
    };
    await cancelDelete();
    expect(deletePalette).not.toHaveBeenCalled();

    deletePalette.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: t.delete }));
    fireEvent.click(await screen.findByRole('button', { name: zhCN.common.delete }));
    await waitFor(() => expect(deletePalette).toHaveBeenCalledWith('id-1', 1));
    await waitFor(() => expect(screen.queryByText('待删')).toBeNull());
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
