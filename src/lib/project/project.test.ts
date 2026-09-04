import { describe, expect, it } from 'vitest';
import { projectFileName, serializeProject, type ProjectSource } from './serialize';
import { importProjectFile, conflictName } from './parse';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { ENGINE_VERSION, LIMITS } from '@/lib/appInfo';

const source: ProjectSource = {
  name: '测试设计',
  createdAt: '2026-08-14T10:00:00.000Z',
  engineVersion: ENGINE_VERSION,
  boardProfile: '2.6mm-50',
  paletteSelection: {
    palette: {
      kind: 'builtin',
      brand: 'pcd:artkal-c-197-official@178dafbc9e77d3de556550dbd058270200129186',
    },
    kitTier: 0,
  },
  params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 60, dithering: true },
  pattern: {
    width: 2,
    height: 1,
    cells: [
      { hex: '#FFFFFF', code: 'C01', transparent: false, external: true },
      { hex: null, code: null, transparent: true },
    ],
  },
};

describe('serializeProject / importProjectFile round-trip', () => {
  it('v3 将色板定义与套装档位作为一个 paletteSelection 往返', () => {
    const text = serializeProject({
      ...source,
      paletteSelection: { ...source.paletteSelection, kitTier: 24 },
    }, new Date('2026-08-14T12:00:00.000Z'));

    const result = importProjectFile(text);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.version).toBe(3);
    expect(result.project.paletteSelection).toEqual({ palette: source.paletteSelection.palette, kitTier: 24 });
    expect(result.project).not.toHaveProperty('palette');
    expect(result.project).not.toHaveProperty('kitTier');
  });

  it('导出 → 导入 → 逐字段相等', () => {
    const before = new Date('2026-08-14T12:00:00.000Z');
    const text = serializeProject({
      ...source,
      paletteSelection: { ...source.paletteSelection, kitTier: 24 },
    }, before);
    const result = importProjectFile(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.project;
    expect(project.format).toBe('doupu-project');
    expect(project.version).toBe(3);
    expect(project.engineVersion).toBe(ENGINE_VERSION);
    expect(project.boardProfile).toBe('2.6mm-50');
    expect(project.paletteSelection.kitTier).toBe(24);
    expect(project.name).toBe(source.name);
    expect(project.createdAt).toBe(source.createdAt);
    expect(project.updatedAt).toBe(before.toISOString());
    expect(project.paletteSelection.palette).toEqual(source.paletteSelection.palette);
    expect(project.params).toEqual(source.params);
    expect(project.pattern).toEqual(source.pattern); // 含 external 标记与透明格
  });

  it('输出为 2 空格缩进的格式化 JSON', () => {
    const text = serializeProject(source, new Date('2026-08-14T12:00:00.000Z'));
    expect(text).toContain('\n  "format": "doupu-project"');
  });

  it('导出文件不包含仅供站内分析使用的社区来源标记', () => {
    const text = serializeProject({ ...source, communityOrigin: true } as ProjectSource & { communityOrigin: true });
    expect(text).not.toContain('communityOrigin');
  });

  it('updatedAt 默认取当前时间', () => {
    const before = Date.now();
    const text = serializeProject(source);
    const after = Date.now();
    const result = importProjectFile(text);
    if (!result.ok) throw new Error('should parse');
    const ts = new Date(result.project.updatedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  it('导出前自校验，拒绝无法重新导入的占位色号项目', () => {
    expect(() => serializeProject({
      ...source,
      paletteSelection: {
        palette: { kind: 'custom', colors: [{ code: '?', hex: '#112233' }] },
        kitTier: 0,
      },
      pattern: {
        width: 1,
        height: 1,
        cells: [{ code: '?', hex: '#112233', transparent: false }],
      },
    })).toThrow();
  });
});

describe('importProjectFile 坏文件矩阵（§5.3 / E38）', () => {
  const valid = () => serializeProject(source, new Date('2026-08-14T12:00:00.000Z'));

  it('非 JSON 与数组拒绝', () => {
    expect(importProjectFile('不是 json').ok).toBe(false);
    expect(importProjectFile('[1,2,3]').ok).toBe(false);
    expect(importProjectFile('null').ok).toBe(false);
  });

  it('超过 5 MB 拒绝（E38）', () => {
    const big = '{"name":"' + 'x'.repeat(LIMITS.projectFileBytes) + '"}';
    const result = importProjectFile(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('5 MB');
  });

  it('未知 version=99 拒绝', () => {
    const json = JSON.parse(valid()) as Record<string, unknown>;
    json.version = 99;
    expect(importProjectFile(JSON.stringify(json)).ok).toBe(false);
  });

  it('v1 和旧 v2 项目文件都明确拒绝', () => {
    const current = JSON.parse(valid()) as Record<string, unknown>;
    const paletteSelection = current.paletteSelection as { palette: unknown; kitTier: unknown };

    const oldV2: Record<string, unknown> = {
      ...current,
      version: 2,
      palette: paletteSelection.palette,
      kitTier: paletteSelection.kitTier,
    };
    delete oldV2.paletteSelection;

    const v1: Record<string, unknown> = { ...oldV2, version: 1 };
    delete v1.engineVersion;
    delete v1.boardProfile;

    expect(importProjectFile(JSON.stringify(oldV2)).ok).toBe(false);
    expect(importProjectFile(JSON.stringify(v1)).ok).toBe(false);
  });

  it('v3 顶层未知字段必须拒绝', () => {
    const withUnknownField = JSON.parse(valid()) as Record<string, unknown>;
    withUnknownField.futureFormatFlag = true;

    expect(importProjectFile(JSON.stringify(withUnknownField)).ok).toBe(false);
  });

  it('外部项目文件不能伪造站内社区来源标记', () => {
    const forged = JSON.parse(valid()) as Record<string, unknown>;
    forged.communityOrigin = true;
    const result = importProjectFile(JSON.stringify(forged));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('communityOrigin: 项目文件不允许包含站内来源标记');
  });

  it('未知 brand 拒绝', () => {
    const json = JSON.parse(valid()) as { paletteSelection: { palette: { kind: string; brand: string } } };
    json.paletteSelection.palette = { kind: 'builtin', brand: 'Perler' };
    expect(importProjectFile(JSON.stringify(json)).ok).toBe(false);
  });

  it('新增内置色板只按登记的稳定 ID 导入', () => {
    const external = JSON.parse(valid()) as { paletteSelection: { palette: { kind: string; brand: string } } };
    external.paletteSelection.palette = {
      kind: 'builtin',
      brand: 'pcd:artkal-c-197-official@178dafbc9e77d3de556550dbd058270200129186',
    };
    expect(importProjectFile(JSON.stringify(external)).ok).toBe(true);

    external.paletteSelection.palette = { kind: 'builtin', brand: 'artkal-c-197-official' };
    expect(importProjectFile(JSON.stringify(external)).ok).toBe(false);
  });

  it('未知制作规格拒绝', () => {
    const json = JSON.parse(valid()) as { boardProfile: string };
    json.boardProfile = '2.6mm-51';
    expect(importProjectFile(JSON.stringify(json)).ok).toBe(false);
  });

  it('拒绝色板与制作规格不兼容的组合', () => {
    const standardBeadsOnMiniBoard = JSON.parse(valid()) as {
      boardProfile: string;
      paletteSelection: { palette: { kind: string; brand: string } };
    };
    standardBeadsOnMiniBoard.paletteSelection.palette = { kind: 'builtin', brand: 'MARD' };
    standardBeadsOnMiniBoard.boardProfile = '2.6mm-50';
    expect(importProjectFile(JSON.stringify(standardBeadsOnMiniBoard)).ok).toBe(false);

    const miniBeadsOnStandardBoard = JSON.parse(valid()) as {
      boardProfile: string;
      paletteSelection: { palette: { kind: string; brand: string } };
    };
    miniBeadsOnStandardBoard.paletteSelection.palette = {
      kind: 'builtin',
      brand: 'pcd:artkal-c-197-official@178dafbc9e77d3de556550dbd058270200129186',
    };
    miniBeadsOnStandardBoard.boardProfile = '5mm-29';
    expect(importProjectFile(JSON.stringify(miniBeadsOnStandardBoard)).ok).toBe(false);
  });

  it('宽度超限（300）拒绝', () => {
    const json = JSON.parse(valid()) as { params: { targetWidth: number } };
    json.params.targetWidth = 300;
    expect(importProjectFile(JSON.stringify(json)).ok).toBe(false);
  });

  it('缺字段（pattern）拒绝且报字段路径', () => {
    const json = JSON.parse(valid()) as Record<string, unknown>;
    delete json.pattern;
    const result = importProjectFile(JSON.stringify(json));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('pattern'))).toBe(true);
  });

  it('非法 hex 拒绝', () => {
    const json = JSON.parse(valid()) as { pattern: { cells: Array<{ hex: string | null }> } };
    json.pattern.cells[0].hex = '#GGGGGG';
    expect(importProjectFile(JSON.stringify(json)).ok).toBe(false);
  });

  it('拒绝非透明格中不属于声明色板的 FAKE code+hex 组合', () => {
    const json = JSON.parse(valid()) as {
      pattern: { cells: Array<{ hex: string | null; code: string | null; transparent: boolean }> };
    };
    json.pattern.cells[0] = { hex: '#FFFFFF', code: 'FAKE', transparent: false };
    const result = importProjectFile(JSON.stringify(json));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.includes('pattern.cells.0'))).toBe(true);
  });

  it('UTF-8 BOM 容忍（端到端）', () => {
    const withBom = '\uFEFF' + valid();
    const result = importProjectFile(withBom);
    expect(result.ok).toBe(true);
  });

  it('合法 code+hex 组合导入时保持原值', () => {
    const text = valid();
    const result = importProjectFile(text);
    if (!result.ok) throw new Error('should parse');
    expect(result.project.pattern.cells[0]).toEqual({ hex: '#FFFFFF', code: 'C01', transparent: false, external: true });
  });
});

describe('conflictName', () => {
  it('无冲突返回原名', () => {
    expect(conflictName('豆谱', [])).toBe('豆谱');
    expect(conflictName('豆谱', ['其他'])).toBe('豆谱');
  });

  it('冲突 → (2)；已有 (2) → (3)', () => {
    expect(conflictName('豆谱', ['豆谱'])).toBe('豆谱 (2)');
    expect(conflictName('豆谱', ['豆谱', '豆谱 (2)'])).toBe('豆谱 (3)');
    expect(conflictName('豆谱', ['豆谱 (2)'])).toBe('豆谱');
  });

  it('100 字符名称冲突时截断基础名（总长 ≤100）', () => {
    const long = '豆'.repeat(100);
    const result = conflictName(long, [long]);
    expect(result.length).toBe(LIMITS.designNameLength);
    expect(result.endsWith(' (2)')).toBe(true);
    expect(result.startsWith('豆')).toBe(true);
  });

  it('追加冲突标签后即使尚未重名也必须先钳制到 100 字符', () => {
    const result = conflictName(`${'豆'.repeat(100)} (冲突副本)`, []);
    expect(result.length).toBe(LIMITS.designNameLength);
  });

  it('后缀序列唯一：连续冲突跳到下一个空位', () => {
    const existing = ['豆谱', '豆谱 (2)', '豆谱 (3)', '豆谱 (4)'];
    expect(conflictName('豆谱', existing)).toBe('豆谱 (5)');
  });
});

describe('projectFileName', () => {
  it('常规名称', () => {
    expect(projectFileName('我的设计')).toBe('豆谱-我的设计.json');
  });
  it('非法文件名字符替换', () => {
    expect(projectFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('豆谱-a-b-c-d-e-f-g-h-i-j.json');
  });
  it('空白名回退', () => {
    expect(projectFileName('   ')).toBe('豆谱-未命名设计.json');
  });
});
