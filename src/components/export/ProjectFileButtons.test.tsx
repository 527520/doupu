// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectFileButtons from './ProjectFileButtons';
import { serializeProject, type ProjectSource } from '@/lib/project/serialize';
import { DEFAULT_GENERATION_PARAMS, type ProjectFile } from '@/lib/types';

const source: ProjectSource = {
  name: '测试设计',
  createdAt: '2026-08-14T10:00:00.000Z',
  engineVersion: '2.0.0',
  palette: { kind: 'builtin', brand: 'MARD' },
  params: { ...DEFAULT_GENERATION_PARAMS },
  pattern: {
    width: 2,
    height: 1,
    cells: [
      { hex: '#FF0000', code: 'F01', transparent: false },
      { hex: null, code: null, transparent: true },
    ],
  },
};

function makeFile(text: string, name = 'test.json'): File {
  return new File([text], name, { type: 'application/json' });
}

async function importFile(file: File): Promise<void> {
  const input = screen.getByLabelText('项目文件选择器') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(input.value).toBe(''));
}

describe('ProjectFileButtons', () => {
  it('导出点击生成带正确文件名与内容的下载', () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<ProjectFileButtons source={source} existingNames={[]} onImport={() => {}} />);
    fireEvent.click(screen.getByText('导出项目文件'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    // 下载锚点无需挂载到 DOM；断言 click spy 实例上的 download 属性
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('download')).toBe('豆谱-测试设计.json');
    clickSpy.mockRestore();
  });

  it('导入合法项目文件触发 onImport', async () => {
    const onImport = vi.fn();
    render(<ProjectFileButtons source={source} existingNames={[]} onImport={onImport} />);
    await importFile(makeFile(serializeProject(source)));
    expect(onImport).toHaveBeenCalledTimes(1);
    const project = onImport.mock.calls[0][0] as ProjectFile;
    expect(project.name).toBe('测试设计');
    expect(project.pattern.width).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('导入名称冲突自动加后缀', async () => {
    const onImport = vi.fn();
    render(<ProjectFileButtons source={source} existingNames={['测试设计', '测试设计 (2)']} onImport={onImport} />);
    await importFile(makeFile(serializeProject(source)));
    const project = onImport.mock.calls[0][0] as ProjectFile;
    expect(project.name).toBe('测试设计 (3)');
  });

  it('导入损坏 JSON 显示字段级错误列表', async () => {
    render(<ProjectFileButtons source={source} existingNames={[]} onImport={vi.fn()} />);
    await importFile(makeFile('{bad json'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('导入失败：')).toBeTruthy();
    expect(screen.getByText('不是有效的 JSON 文件')).toBeTruthy();
  });

  it('导入未知 brand 显示对应错误', async () => {
    render(<ProjectFileButtons source={source} existingNames={[]} onImport={vi.fn()} />);
    const json = JSON.parse(serializeProject(source)) as { palette: { kind: string; brand: string } };
    json.palette = { kind: 'builtin', brand: 'Perler' };
    await importFile(makeFile(JSON.stringify(json)));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/palette/)).toBeTruthy();
  });

  it('导入超过 5 MB 显示体积错误', async () => {
    render(<ProjectFileButtons source={source} existingNames={[]} onImport={vi.fn()} />);
    const big = makeFile(serializeProject(source).padEnd(5 * 1024 * 1024 + 1, ' '));
    await importFile(big);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('项目文件超过 5 MB 上限')).toBeTruthy();
  });

  it('导入失败后可再次导入成功（错误清除）', async () => {
    const onImport = vi.fn();
    render(<ProjectFileButtons source={source} existingNames={[]} onImport={onImport} />);
    await importFile(makeFile('{bad json'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    await importFile(makeFile(serializeProject(source)));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('disabled 时两个按钮禁用', () => {
    render(<ProjectFileButtons source={source} existingNames={[]} onImport={() => {}} disabled />);
    expect((screen.getByText('导出项目文件') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('导入项目文件') as HTMLButtonElement).disabled).toBe(true);
  });
});
