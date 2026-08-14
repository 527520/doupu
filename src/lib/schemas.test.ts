import { describe, expect, it } from 'vitest';
import {
  customPaletteColorsSchema,
  designNameSchema,
  emailSchema,
  generationParamsSchema,
  hexSchema,
  parseGenerationParams,
  parseProjectFile,
  passwordSchema,
  patternCellSchema,
  patternSchema,
  projectFileSchema,
  registerSchema,
} from './schemas';
import { DEFAULT_GENERATION_PARAMS } from './types';

function cell(hex: string, code: string | null) {
  return { hex, code, transparent: false };
}
function transparentCell() {
  return { hex: null, code: null, transparent: true };
}

function validProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const project = {
    format: 'doupu-project',
    version: 1,
    name: '测试设计',
    createdAt: '2026-08-14T10:00:00.000Z',
    updatedAt: '2026-08-14T11:00:00.000Z',
    palette: { kind: 'builtin', brand: 'MARD' },
    params: DEFAULT_GENERATION_PARAMS,
    pattern: {
      width: 2,
      height: 1,
      cells: [cell('#FF0000', 'F01'), transparentCell()],
    },
  };
  return { ...project, ...overrides };
}

describe('generationParamsSchema（E14/E15/E17）', () => {
  it('接受边界值 20/200/2/128/-100/100/0/40', () => {
    expect(
      generationParamsSchema.safeParse({ ...DEFAULT_GENERATION_PARAMS, targetWidth: 20 }).success,
    ).toBe(true);
    expect(
      generationParamsSchema.safeParse({ ...DEFAULT_GENERATION_PARAMS, targetWidth: 200 }).success,
    ).toBe(true);
    expect(
      generationParamsSchema.safeParse({ ...DEFAULT_GENERATION_PARAMS, targetColorCount: 2 }).success,
    ).toBe(true);
    expect(
      generationParamsSchema.safeParse({ ...DEFAULT_GENERATION_PARAMS, targetColorCount: 128 }).success,
    ).toBe(true);
    expect(
      generationParamsSchema.safeParse({ ...DEFAULT_GENERATION_PARAMS, brightness: -100, contrast: 100, bgTolerance: 0 }).success,
    ).toBe(true);
    expect(
      generationParamsSchema.safeParse({ ...DEFAULT_GENERATION_PARAMS, brightness: 100, contrast: -100, bgTolerance: 40 }).success,
    ).toBe(true);
  });

  it('拒绝越界与非整数（0/19/201/1/129/±101/41/小数/字符串）', () => {
    const bad: Array<Partial<Record<string, unknown>>> = [
      { targetWidth: 0 },
      { targetWidth: 19 },
      { targetWidth: 201 },
      { targetWidth: 100.5 },
      { targetWidth: '100' },
      { targetColorCount: 1 },
      { targetColorCount: 129 },
      { brightness: -101 },
      { contrast: 101 },
      { bgTolerance: -1 },
      { bgTolerance: 41 },
      { mode: 'other' },
      { dithering: 'yes' },
    ];
    for (const override of bad) {
      expect(
        generationParamsSchema.safeParse({ ...DEFAULT_GENERATION_PARAMS, ...override }).success,
        JSON.stringify(override),
      ).toBe(false);
    }
  });

  it('parseGenerationParams 返回字段级错误', () => {
    const result = parseGenerationParams({ ...DEFAULT_GENERATION_PARAMS, targetWidth: 999, mode: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith('targetWidth'))).toBe(true);
      expect(result.errors.some((e) => e.startsWith('mode'))).toBe(true);
    }
  });
});

describe('hex 与单元格', () => {
  it('接受合法 hex（大小写均可）', () => {
    expect(hexSchema.safeParse('#FAF4C8').success).toBe(true);
    expect(hexSchema.safeParse('#faf4c8').success).toBe(true);
    expect(hexSchema.safeParse('#000000').success).toBe(true);
    expect(hexSchema.safeParse('#FFFFFF').success).toBe(true);
  });

  it('拒绝非法 hex', () => {
    for (const bad of ['#FFF', 'FFF000', '#GGGGGG', '#FFFFF', '#FFFFF!', '', 'rgb(0,0,0)']) {
      expect(hexSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('单元格：透明格不得携带颜色；非透明格必须携带 hex（E10/E11）', () => {
    expect(patternCellSchema.safeParse(transparentCell()).success).toBe(true);
    expect(patternCellSchema.safeParse(cell('#123456', null)).success).toBe(true);
    expect(patternCellSchema.safeParse(cell('#123456', 'A'.repeat(20))).success).toBe(true);
    expect(patternCellSchema.safeParse({ hex: '#123456', code: null, transparent: true }).success).toBe(false);
    expect(patternCellSchema.safeParse({ hex: null, code: null, transparent: false }).success).toBe(false);
    expect(patternCellSchema.safeParse(cell('#123456', 'A'.repeat(21))).success).toBe(false);
  });

  it('图纸：cells 数量必须与宽高一致；1×1 与 200×200 合法，201 非法（E7/E14）', () => {
    expect(
      patternSchema.safeParse({ width: 1, height: 1, cells: [cell('#000000', null)] }).success,
    ).toBe(true);
    expect(patternSchema.safeParse({ width: 2, height: 1, cells: [cell('#000000', null)] }).success).toBe(false);
    expect(patternSchema.safeParse({ width: 0, height: 1, cells: [] }).success).toBe(false);
    expect(patternSchema.safeParse({ width: 201, height: 1, cells: [] }).success).toBe(false);
  });
});

describe('项目文件（§5.3）', () => {
  it('完整合法文件可解析', () => {
    expect(parseProjectFile(JSON.stringify(validProject())).ok).toBe(true);
  });

  it('拒绝缺字段/未知 version/未知 brand/非法日期/空白名', () => {
    const cases: Record<string, unknown>[] = [
      validProject({ version: 2 }),
      validProject({ format: 'other' }),
      validProject({ palette: { kind: 'builtin', brand: 'Perler' } }),
      validProject({ name: '   ' }),
      validProject({ createdAt: '昨天' }),
      validProject({ pattern: { width: 2, height: 1, cells: [cell('#GGGGGG', null), transparentCell()] } }),
      { ...validProject(), params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 300 } },
    ];
    for (const c of cases) {
      const result = parseProjectFile(JSON.stringify(c));
      expect(result.ok, JSON.stringify(c).slice(0, 80)).toBe(false);
    }
  });

  it('容忍 UTF-8 BOM（E11）', () => {
    const withBom = '\uFEFF' + JSON.stringify(validProject());
    expect(parseProjectFile(withBom).ok).toBe(true);
  });

  it('超过 5 MB 拒绝（E38），且不进入 JSON 解析', () => {
    const big = '{"name":"' + 'x'.repeat(5 * 1024 * 1024) + '"}';
    const result = parseProjectFile(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('5 MB');
  });

  it('非 JSON 内容拒绝', () => {
    expect(parseProjectFile('不是json').ok).toBe(false);
    expect(parseProjectFile('null').ok).toBe(false);
    expect(parseProjectFile('[1,2,3]').ok).toBe(false);
  });

  it('名称 100 字符通过、101 拒绝；首尾空白被裁剪', () => {
    const p100 = validProject({ name: '豆'.repeat(100) });
    expect(projectFileSchema.safeParse(p100).success).toBe(true);
    const p101 = validProject({ name: '豆'.repeat(101) });
    expect(projectFileSchema.safeParse(p101).success).toBe(false);
    const trimmed = projectFileSchema.parse(validProject({ name: '  豆谱  ' }));
    expect(trimmed.name).toBe('豆谱');
  });
});

describe('自定义色板（E20）', () => {
  const colors = (n: number) => Array.from({ length: n }, (_, i) => ({ code: `C${i + 1}`, hex: `#${(0x000001 + i).toString(16).padStart(6, '0').toUpperCase()}` }));

  it('0 色拒绝、500 色通过、501 色拒绝', () => {
    expect(customPaletteColorsSchema.safeParse([]).success).toBe(false);
    expect(customPaletteColorsSchema.safeParse(colors(500)).success).toBe(true);
    expect(customPaletteColorsSchema.safeParse(colors(501)).success).toBe(false);
  });

  it('重复 hex（大小写不敏感）与重复色号拒绝', () => {
    expect(
      customPaletteColorsSchema.safeParse([
        { code: 'A', hex: '#FF0000' },
        { code: 'B', hex: '#ff0000' },
      ]).success,
    ).toBe(false);
    expect(
      customPaletteColorsSchema.safeParse([
        { code: 'A', hex: '#FF0000' },
        { code: 'a', hex: '#00FF00' },
      ]).success,
    ).toBe(false);
    expect(
      customPaletteColorsSchema.safeParse([
        { code: 'A', hex: '#FF0000' },
        { code: 'B', hex: '#00FF00' },
      ]).success,
    ).toBe(true);
  });

  it('非法 hex 与超长/空色号拒绝', () => {
    expect(customPaletteColorsSchema.safeParse([{ code: 'A', hex: '#FFF' }]).success).toBe(false);
    expect(customPaletteColorsSchema.safeParse([{ code: '', hex: '#FF0000' }]).success).toBe(false);
    expect(customPaletteColorsSchema.safeParse([{ code: 'X'.repeat(21), hex: '#FF0000' }]).success).toBe(false);
  });
});

describe('账号 DTO（E31）', () => {
  it('邮箱：格式校验、统一小写、过长拒绝', () => {
    expect(emailSchema.parse('  Foo@Example.COM ')).toBe('foo@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('a@b.c').success).toBe(false);
    expect(emailSchema.safeParse(`${'a'.repeat(250)}@example.com`).success).toBe(false);
  });

  it('密码边界 7/8/72/73 与首尾空白（E31）', () => {
    expect(passwordSchema.safeParse('a'.repeat(7)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(8)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(73)).success).toBe(false);
    expect(passwordSchema.safeParse('  abcdefgh').success).toBe(false);
    expect(passwordSchema.safeParse('abcdefgh  ').success).toBe(false);
    expect(passwordSchema.safeParse('ab cd efgh').success).toBe(true); // 中间空白允许
  });

  it('注册 DTO 组合校验', () => {
    expect(registerSchema.safeParse({ email: 'a@b.com', password: '12345678' }).success).toBe(true);
    expect(registerSchema.safeParse({ email: 'bad', password: 'short' }).success).toBe(false);
  });
});

describe('designNameSchema', () => {
  it('裁剪首尾空白；空串与纯空白拒绝', () => {
    expect(designNameSchema.parse('  豆谱  ')).toBe('豆谱');
    expect(designNameSchema.safeParse('').success).toBe(false);
    expect(designNameSchema.safeParse('   ').success).toBe(false);
  });
});
