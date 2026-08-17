import { describe, expect, it } from 'vitest';
import { projectFileName, serializeProject, type ProjectSource } from './serialize';
import { importProjectFile, conflictName } from './parse';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { ENGINE_VERSION, LIMITS } from '@/lib/appInfo';

const source: ProjectSource = {
  name: '测试设计',
  createdAt: '2026-08-14T10:00:00.000Z',
  engineVersion: ENGINE_VERSION,
  palette: { kind: 'builtin', brand: 'MARD' },
  params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 60, dithering: true },
  pattern: {
    width: 2,
    height: 1,
    cells: [
      { hex: '#FF0000', code: 'F01', transparent: false, external: true },
      { hex: null, code: null, transparent: true },
    ],
  },
};

describe('serializeProject / importProjectFile round-trip', () => {
  it('导出 → 导入 → 逐字段相等', () => {
    const before = new Date('2026-08-14T12:00:00.000Z');
    const text = serializeProject(source, before);
    const result = importProjectFile(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.project;
    expect(project.format).toBe('doupu-project');
    expect(project.version).toBe(2);
    expect(project.engineVersion).toBe(ENGINE_VERSION);
    expect(project.name).toBe(source.name);
    expect(project.createdAt).toBe(source.createdAt);
    expect(project.updatedAt).toBe(before.toISOString());
    expect(project.palette).toEqual(source.palette);
    expect(project.params).toEqual(source.params);
    expect(project.pattern).toEqual(source.pattern); // 含 external 标记与透明格
  });

  it('输出为 2 空格缩进的格式化 JSON', () => {
    const text = serializeProject(source, new Date('2026-08-14T12:00:00.000Z'));
    expect(text).toContain('\n  "format": "doupu-project"');
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

  it('v1 只允许导入并迁移成带 legacy 引擎标记的 v2', () => {
    const legacy = JSON.parse(valid()) as Record<string, unknown>;
    legacy.version = 1;
    delete legacy.engineVersion;

    const result = importProjectFile(JSON.stringify(legacy));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.version).toBe(2);
    expect(result.project.engineVersion).toBe('legacy-v1');
  });

  it('v1 携带 v2 engineVersion 的混代文件必须拒绝', () => {
    const mixed = JSON.parse(valid()) as Record<string, unknown>;
    mixed.version = 1;

    expect(importProjectFile(JSON.stringify(mixed)).ok).toBe(false);
  });

  it('v2 顶层未知字段必须拒绝', () => {
    const withUnknownField = JSON.parse(valid()) as Record<string, unknown>;
    withUnknownField.futureFormatFlag = true;

    expect(importProjectFile(JSON.stringify(withUnknownField)).ok).toBe(false);
  });

  it('未知 brand 拒绝', () => {
    const json = JSON.parse(valid()) as { palette: { kind: string; brand: string } };
    json.palette = { kind: 'builtin', brand: 'Perler' };
    expect(importProjectFile(JSON.stringify(json)).ok).toBe(false);
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

  it('UTF-8 BOM 容忍（端到端）', () => {
    const withBom = '\uFEFF' + valid();
    const result = importProjectFile(withBom);
    expect(result.ok).toBe(true);
  });

  it('hex 为准、code 仅展示：跨品牌导入仍成立', () => {
    // 导出时用 MARD 色号，导入后不改 hex；code 保留原值（展示语义）
    const text = valid();
    const result = importProjectFile(text);
    if (!result.ok) throw new Error('should parse');
    expect(result.project.pattern.cells[0]).toEqual({ hex: '#FF0000', code: 'F01', transparent: false, external: true });
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
