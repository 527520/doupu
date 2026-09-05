// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaletteEditor, { nextAutoCode, parseHexList, validateRows, type EditorRow } from './PaletteEditor';
import { zhCN } from '@/messages/zh-CN';
import { getBuiltinPalette } from '@/lib/palettes';
import { BRANDS } from '@/lib/types';
import { LIMITS } from '@/lib/appInfo';

const t = zhCN.palettes.editor;

function setup(over: { initialName?: string; initialColors?: Array<{ code: string; hex: string }> } = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <PaletteEditor
      initialName={over.initialName ?? '测试色板'}
      initialColors={over.initialColors ?? [{ code: 'A', hex: '#FF0000' }]}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );
  return { onSave, onCancel };
}

function changeRow(index: number, patch: Partial<EditorRow>) {
  if (patch.code !== undefined) {
    fireEvent.change(screen.getByLabelText(`${t.code} ${index + 1}`), { target: { value: patch.code } });
  }
  if (patch.hex !== undefined) {
    fireEvent.change(screen.getByLabelText(`${t.hex} ${index + 1}`), { target: { value: patch.hex } });
  }
}

describe('PaletteEditor 校验矩阵（E20）', () => {
  it('非法 hex 行内报错，保存禁用', () => {
    setup();
    changeRow(0, { hex: '#GGGGGG' });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('必须是 #RRGGBB 格式的颜色值')).toBeTruthy();
    expect(screen.getByRole('button', { name: t.save }).hasAttribute('disabled')).toBe(true);
  });

  it('重复色号（大小写不敏感）在第二行报错', () => {
    setup({ initialColors: [{ code: 'A', hex: '#FF0000' }, { code: 'B', hex: '#00FF00' }] });
    changeRow(1, { code: 'a' });
    expect(screen.getByText(/色号 a 重复/)).toBeTruthy();
  });

  it('重复 hex（大小写不敏感）在第二行报错', () => {
    setup({ initialColors: [{ code: 'A', hex: '#FF0000' }, { code: 'B', hex: '#00FF00' }] });
    changeRow(1, { hex: '#ff0000' });
    expect(screen.getByText(/颜色 #ff0000 重复/)).toBeTruthy();
  });

  it('超长色号（21 字）报错；输入框 maxLength 为 20', () => {
    setup();
    const input = screen.getByLabelText(`${t.code} 1`) as HTMLInputElement;
    expect(input.maxLength).toBe(LIMITS.customPaletteCodeLength);
    changeRow(0, { code: 'X'.repeat(21) });
    expect(screen.getByText(/色号最长 20 字符/)).toBeTruthy();
  });

  it('删除全部行 → 全局空板错误，保存禁用', () => {
    setup();
    fireEvent.click(screen.getByLabelText(`${t.removeRow} 1`));
    // 全局错误来自 schema（zod 文案，无句号）
    expect(screen.getByText(/至少需要 1 个颜色/)).toBeTruthy();
    expect(screen.getByRole('button', { name: t.save }).hasAttribute('disabled')).toBe(true);
  });

  it('初始 500 色：计数 500/500，添加按钮禁用', () => {
    const colors = Array.from({ length: 500 }, (_, i) => ({
      code: `C${String(i + 1).padStart(3, '0')}`,
      hex: `#${(i + 1).toString(16).padStart(6, '0').toUpperCase()}`,
    }));
    render(<PaletteEditor initialName="大色板" initialColors={colors} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText(t.colorsCounter(500))).toBeTruthy();
    expect(screen.getByRole('button', { name: t.addRow }).hasAttribute('disabled')).toBe(true);
  });

  it('501 色直接由 schema 拦截为全局超限错误', () => {
    const rows: EditorRow[] = Array.from({ length: 501 }, (_, i) => ({
      code: `C${i + 1}`,
      hex: `#${(i + 1).toString(16).padStart(6, '0').toUpperCase()}`,
    }));
    const result = validateRows(rows);
    expect(result.global).toContain('500');
  });

  it('名称空 → 名称错误，保存禁用', () => {
    setup({ initialName: '' });
    // 名称错误来自 designNameSchema（zod 文案）
    expect(screen.getByText(/名称不能为空/)).toBeTruthy();
    expect(screen.getByRole('button', { name: t.save }).hasAttribute('disabled')).toBe(true);
  });

  it('合法数据点保存：名称裁剪、hex 统一大写', () => {
    const { onSave } = setup({ initialName: '  新板  ', initialColors: [{ code: ' a ', hex: '#abcdef' }] });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    expect(onSave).toHaveBeenCalledWith('新板', [{ code: 'a', hex: '#ABCDEF' }]);
  });
});

describe('PaletteEditor 导入', () => {
  it('粘贴导入：严格解析 hex 列表并自动补色号', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: t.pasteImport })); // 展开面板
    fireEvent.change(screen.getByLabelText(t.pasteImport), { target: { value: '#112233\n223344\n#AABBCC' } });
    const importButtons = screen.getAllByRole('button', { name: t.pasteImport });
    fireEvent.click(importButtons[importButtons.length - 1]); // 面板内「粘贴导入」按钮
    // 初始 1 行 + 新增 3 行（#223344 自动补 #）
    expect(screen.getByLabelText(`${t.hex} 4`)).toBeTruthy();
    expect(screen.queryByLabelText(`${t.hex} 5`)).toBeNull();
  });

  it('粘贴导入任一坏行会整批拒绝，保留原草稿并显示行号', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: t.pasteImport }));
    fireEvent.change(screen.getByLabelText(t.pasteImport), { target: { value: '#112233\nnot-a-hex\n#445566' } });
    const importButtons = screen.getAllByRole('button', { name: t.pasteImport });
    fireEvent.click(importButtons[importButtons.length - 1]);
    expect(screen.getByRole('alert')).toHaveTextContent('第 2 行');
    expect(screen.getByLabelText(t.pasteImport)).toHaveValue('#112233\nnot-a-hex\n#445566');
    expect(screen.queryByLabelText(`${t.hex} 2`)).toBeNull();
  });

  it('粘贴导入 code,hex CSV：保留真实色号并忽略附加列', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: t.pasteImport }));
    fireEvent.change(screen.getByLabelText(t.pasteImport), {
      target: { value: 'notes,hex,code\n"warm, skin",#112233,A01\nplain,445566,B02' },
    });
    const importButtons = screen.getAllByRole('button', { name: t.pasteImport });
    fireEvent.click(importButtons[importButtons.length - 1]);
    expect(screen.getByLabelText(`${t.code} 2`)).toHaveValue('A01');
    expect(screen.getByLabelText(`${t.hex} 2`)).toHaveValue('#112233');
    expect(screen.getByLabelText(`${t.code} 3`)).toHaveValue('B02');
  });

  it('文件导入共用同一严格解析器，CSV MIME 可选且失败不改草稿', async () => {
    setup();
    const input = screen.getByLabelText(t.fileImport) as HTMLInputElement;
    expect(input.accept).toContain('text/csv');
    const file = { text: vi.fn().mockResolvedValue('code,hex\nA01,broken') } as unknown as File;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('第 2 行'));
    expect(screen.queryByLabelText(`${t.hex} 2`)).toBeNull();
  });

  it('文件读取期间继续编辑，导入仍以最新草稿做重复校验', async () => {
    setup();
    let resolveText!: (value: string) => void;
    const file = {
      text: vi.fn(() => new Promise<string>((resolve) => { resolveText = resolve; })),
    } as unknown as File;
    fireEvent.change(screen.getByLabelText(t.fileImport), { target: { files: [file] } });
    changeRow(0, { code: 'A01' });
    resolveText('code,hex\nA01,#112233');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('与当前色板重复'));
    expect(screen.queryByLabelText(`${t.hex} 2`)).toBeNull();
  });

  it('复制自内置色板：只复制可生成色，保留真实色号且不造 C001', async () => {
    const builtin = getBuiltinPalette('漫漫');
    setup({ initialColors: [{ code: 'A', hex: '#FF0000' }, { code: 'B', hex: '#00FF00' }] });
    const user=userEvent.setup();
    await user.click(screen.getByRole('button',{name:new RegExp(t.copyFromBrand)}));
    await user.type(screen.getByRole('searchbox',{name:'搜索选项'}),builtin.brand);
    await user.click(screen.getByRole('option',{name:`${builtin.brand} · ${builtin.series}`}));
    fireEvent.click(await screen.findByRole('button', { name: t.copyConfirmAction }));
    await waitFor(() => expect(screen.getByLabelText(t.colorsCounter(builtin.engineColorCount))).toBeTruthy());
    const copiedCodes = screen
      .getAllByLabelText(new RegExp(`^${t.code} \\d+$`))
      .map((input) => (input as HTMLInputElement).value);
    expect(copiedCodes).toEqual(builtin.engineColors.map((color) => color.code));
  });

  it('复制自品牌在确认被拒时不覆盖', async () => {
    setup({ initialColors: [{ code: 'A', hex: '#FF0000' }, { code: 'B', hex: '#00FF00' }] });
    const builtin=getBuiltinPalette('COCO');const user=userEvent.setup();
    await user.click(screen.getByRole('button',{name:new RegExp(t.copyFromBrand)}));
    await user.type(screen.getByRole('searchbox',{name:'搜索选项'}),builtin.brand);
    await user.click(screen.getByRole('option',{name:`${builtin.brand} · ${builtin.series}`}));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: zhCN.common.cancel }));
    expect(screen.getByLabelText(`${t.hex} 1`)).toBeTruthy();
    expect(screen.queryByLabelText(t.colorsCounter(291))).toBeNull();
  });
});

describe('纯函数', () => {
  it('parseHexList：带 #/不带 #、大小写、非法行过滤', () => {
    expect(parseHexList('#AABBCC\n112233\n  #ff0000  \nxyz\n#12345G')).toEqual(['#AABBCC', '#112233', '#FF0000']);
    expect(parseHexList('')).toEqual([]);
  });

  it('nextAutoCode：跳过已占用色号（归一化）', () => {
    expect(nextAutoCode([])).toBe('C001');
    expect(nextAutoCode([{ code: 'C001', hex: '#000000' }])).toBe('C002');
    expect(nextAutoCode([{ code: 'c001', hex: '#000000' }])).toBe('C002');
  });

  it('validateRows 边界：1 色通过、0 色全局错误', () => {
    expect(validateRows([{ code: 'A', hex: '#FF0000' }]).global).toBeNull();
    expect(validateRows([]).global).toContain('至少需要 1 个颜色');
  });

  it('BRANDS 共五套且均为内置品牌', () => {
    expect(BRANDS).toHaveLength(5);
  });
});
