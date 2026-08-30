import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getBuiltinPalette,
  isBuiltinPaletteId,
  listBuiltinPalettes,
} from './index';
import rawColorSystemMapping from './data/colorSystemMapping.json';
import { BRANDS, type Brand } from '@/lib/types';
import { zhCN } from '@/messages/zh-CN';
import * as publicCatalog from './index';

const COLOR_SYSTEM_SIZE = 291;
const sourceColorSystem = rawColorSystemMapping as Record<
  string,
  Partial<Record<Brand, string>>
>;

describe('内置色板目录', () => {
  const PINNED_REVISION = '178dafbc9e77d3de556550dbd058270200129186';
  const versionedId = <T extends string>(upstreamId: T) => `pcd:${upstreamId}@${PINNED_REVISION}` as const;
  const EXPECTED_VISIBLE_IDS = [
    'MARD',
    'COCO',
    '漫漫',
    '盼盼',
    '咪小窝',
    versionedId('mard-291-github'),
    versionedId('coco-291'),
    versionedId('manman-278'),
    versionedId('panpan-289'),
    versionedId('mixiaowo-290'),
    versionedId('mard-221-alfonse-doudou'),
    versionedId('artkal-c-197-official'),
    versionedId('artkal-m-221-official'),
  ] as const;

  it('仅公开产品确认的 13 套，并可通过稳定 ID 读取', () => {
    const palettes = listBuiltinPalettes();

    expect(palettes.map((palette) => palette.id)).toEqual(EXPECTED_VISIBLE_IDS);
    expect(new Set(palettes.map((palette) => palette.id)).size).toBe(13);

    for (const summary of palettes) {
      expect(isBuiltinPaletteId(summary.id)).toBe(true);
      const complete = getBuiltinPalette(summary.id);
      expect(complete).toMatchObject(summary);
      expect('colors' in summary).toBe(false);
      expect('engineColors' in summary).toBe(false);
      expect(Object.isFrozen(complete)).toBe(true);
      expect(Object.isFrozen(complete.colors)).toBe(true);
      expect(Object.isFrozen(complete.engineColors)).toBe(true);
      expect(Object.isFrozen(complete.colors[0])).toBe(true);
    }

    expect(isBuiltinPaletteId('mard-291-github')).toBe(false);
    expect(isBuiltinPaletteId('mard-221-github')).toBe(false);
    expect(isBuiltinPaletteId('artkal-c197-m221-418-official')).toBe(false);
    expect(isBuiltinPaletteId('youken-public-174')).toBe(false);
    expect(isBuiltinPaletteId('not-a-palette')).toBe(false);
  });

  it('业务入口只公开 list/get/is 三个运行时操作', () => {
    expect(Object.keys(publicCatalog).sort()).toEqual([
      'getBuiltinPalette',
      'isBuiltinPaletteId',
      'listBuiltinPalettes',
    ]);
  });

  it('列表摘要不加载颜色数组，但提供展示、规格、来源与排除统计', () => {
    const summaries = listBuiltinPalettes();

    expect(Object.isFrozen(summaries)).toBe(true);
    for (const summary of summaries) {
      expect(summary.label).not.toBe('');
      expect(summary.brand).not.toBe('');
      expect(summary.series).not.toBe('');
      expect(summary.specification).not.toBe('');
      expect(summary.source.versionId).not.toBe('');
      expect(summary.source.qualityLabel).not.toBe('');
      expect(summary.source.qualitySummary).not.toBe('');
      expect(summary.source.references.length).toBeGreaterThan(0);
      expect(summary.colorCount).toBeGreaterThan(0);
      expect(summary.engineColorCount).toBe(summary.colorCount - summary.exclusions.total);
      expect(Object.isFrozen(summary)).toBe(true);
      expect(Object.isFrozen(summary.source)).toBe(true);
      expect(Object.isFrozen(summary.exclusions)).toBe(true);
    }
  });

  it('目录直接提供消息模块统一管理的展示文案', () => {
    const expectedCopy = Object.values(zhCN.palettes.builtinCatalog).map((copy) => ({
      label: copy.label,
      brand: copy.brand,
      series: copy.series,
      description: copy.description,
      specification: copy.specification,
      qualityLabel: copy.sourceQualityLabel,
      qualitySummary: copy.sourceQualitySummary,
    }));

    expect(
      listBuiltinPalettes().map((palette) => ({
        label: palette.label,
        brand: palette.brand,
        series: palette.series,
        description: palette.description,
        specification: palette.specification,
        qualityLabel: palette.source.qualityLabel,
        qualitySummary: palette.source.qualitySummary,
      })),
    ).toEqual(expectedCopy);
  });

  it('经典五套完整展示数据与共享矩阵一致并命中当前 golden', () => {
    const expectedHashes: Record<Brand, string> = {
      MARD: '93068397e999b0ca8ba2f999c1225ad8a65e97fd5986d5faa65e39034797e2b8',
      COCO: '6cb069f2b4a06a8052a12d7393981f14ad44c3d6ce8f299b62b151b525d818e7',
      漫漫: 'e4ce285708698d2cf89b09c85c98886cb42d7c436e01b78078de4c82bf671b1f',
      盼盼: 'cfd29be76a3322f372070658c44441557c2f472ceb43b8e8c0357a4720a834b6',
      咪小窝: 'e4eb0b382a8eef0253ee1a979e56cd9b6d9811aef63a27c2c3ceafc50fe6212b',
    };

    for (const brand of BRANDS) {
      const catalog = getBuiltinPalette(brand);
      const displayPairs = catalog.colors.map(({ code, hex }) => ({ code, hex }));
      const serialized = displayPairs.map(({ code, hex }) => `${code ?? ''}\t${hex.toUpperCase()}`).join('\n');

      expect(displayPairs).toHaveLength(COLOR_SYSTEM_SIZE);
      expect(createHash('sha256').update(serialized).digest('hex')).toBe(expectedHashes[brand]);
    }
  });

  it('旧五套目录分别来自独立的不可变紧凑数据文件', () => {
    const expectedPaths: Record<Brand, string> = {
      MARD: 'src/lib/palettes/data/legacy/mard.generated.json',
      COCO: 'src/lib/palettes/data/legacy/coco.generated.json',
      漫漫: 'src/lib/palettes/data/legacy/manman.generated.json',
      盼盼: 'src/lib/palettes/data/legacy/panpan.generated.json',
      咪小窝: 'src/lib/palettes/data/legacy/mixiaowo.generated.json',
    };

    const actualPaths = BRANDS.map((brand) => {
      const palette = getBuiltinPalette(brand);
      expect(palette.source.path).toBe('src/app/colorSystemMapping.json');
      expect(palette.source.vendoredPath).toBe(expectedPaths[brand]);
      expect(palette.source.versionId).toBe(`zippland-291-v1/${brand}`);
      return palette.source.vendoredPath;
    });

    expect(new Set(actualPaths).size).toBe(BRANDS.length);
  });

  it('外部八套固定到指定上游 commit，并保持完整展示顺序', () => {
    const expected: Record<
      Exclude<(typeof EXPECTED_VISIBLE_IDS)[number], Brand>,
      { count: number; displayHash: string }
    > = {
      [versionedId('mard-291-github')]: {
        count: 291,
        displayHash: '996d88e73dfad987a73a2eec4471efdb282bd3c01b71075b5980f84ce4335b4d',
      },
      [versionedId('coco-291')]: {
        count: 291,
        displayHash: '7ba8daca35b5033c0afff1b7adc0cc6e2075ffbb0d8d4e145f53e72a28be845c',
      },
      [versionedId('manman-278')]: {
        count: 278,
        displayHash: '440aafc6f2059cd08c90969e57a9afe5b2ecac4c7c5940899684549e3083856a',
      },
      [versionedId('panpan-289')]: {
        count: 289,
        displayHash: '08376296aa23c78de90be67b6b99f57a4d3b2e98ad0fe02b9fa88f87862edae1',
      },
      [versionedId('mixiaowo-290')]: {
        count: 290,
        displayHash: 'af48bab97524dfa337bf34a6146ceaa84e60ad60cf44974511bdc5d38f938946',
      },
      [versionedId('mard-221-alfonse-doudou')]: {
        count: 221,
        displayHash: '7f78ac2ec800cae170dac910aade1b842bc1f4ecd6084532cd7eb476fe7f8aa8',
      },
      [versionedId('artkal-c-197-official')]: {
        count: 197,
        displayHash: '8f372f8de5d47e8fd8facceb94cb871f247506d05c1bddf9508fd5c286318515',
      },
      [versionedId('artkal-m-221-official')]: {
        count: 221,
        displayHash: 'c8700d029909d7c2b6399635c4cabac8840dc71e3607aa997664a563c843b7a0',
      },
    };

    for (const [id, golden] of Object.entries(expected)) {
      expect(isBuiltinPaletteId(id)).toBe(true);
      if (!isBuiltinPaletteId(id)) throw new Error(`测试数据包含未知色板: ${id}`);

      const palette = getBuiltinPalette(id);
      const serialized = palette.colors
        .map(({ code, hex }) => `${code ?? ''}\t${hex.toUpperCase()}`)
        .join('\n');

      expect(palette.colorCount).toBe(golden.count);
      expect(palette.colors).toHaveLength(golden.count);
      expect(createHash('sha256').update(serialized).digest('hex')).toBe(golden.displayHash);
      const upstreamId = id.slice(4, id.lastIndexOf('@'));
      expect(palette.source).toMatchObject({
        repository: 'HansBug/pindou-color-data',
        revision: PINNED_REVISION,
        path: `${upstreamId}/colors.json`,
        vendoredPath: `src/lib/palettes/data/pindou-color-data.generated.json#${upstreamId}`,
        license: 'MIT',
      });
      expect(palette.source.versionId).toBe(
        `pindou-color-data@${PINNED_REVISION}/${upstreamId}`,
      );
    }
  });

  it('engineColors 仅保留合法、已识别且 HEX 唯一的颜色', () => {
    const expected = [
      { id: 'MARD', engine: 291, unavailableCode: 0, transparent: 0, unidentified: 0, duplicateHex: 0 },
      { id: 'COCO', engine: 291, unavailableCode: 0, transparent: 0, unidentified: 0, duplicateHex: 0 },
      { id: '漫漫', engine: 290, unavailableCode: 1, transparent: 0, unidentified: 0, duplicateHex: 0 },
      { id: '盼盼', engine: 291, unavailableCode: 0, transparent: 0, unidentified: 0, duplicateHex: 0 },
      { id: '咪小窝', engine: 291, unavailableCode: 0, transparent: 0, unidentified: 0, duplicateHex: 0 },
      { id: versionedId('mard-291-github'), engine: 291, unavailableCode: 0, transparent: 0, unidentified: 0, duplicateHex: 0 },
      { id: versionedId('coco-291'), engine: 289, unavailableCode: 0, transparent: 0, unidentified: 0, duplicateHex: 2 },
      { id: versionedId('manman-278'), engine: 277, unavailableCode: 0, transparent: 0, unidentified: 0, duplicateHex: 1 },
      { id: versionedId('panpan-289'), engine: 285, unavailableCode: 0, transparent: 0, unidentified: 4, duplicateHex: 0 },
      { id: versionedId('mixiaowo-290'), engine: 286, unavailableCode: 0, transparent: 0, unidentified: 4, duplicateHex: 0 },
      { id: versionedId('mard-221-alfonse-doudou'), engine: 221, unavailableCode: 0, transparent: 0, unidentified: 0, duplicateHex: 0 },
      { id: versionedId('artkal-c-197-official'), engine: 188, unavailableCode: 0, transparent: 9, unidentified: 0, duplicateHex: 0 },
      { id: versionedId('artkal-m-221-official'), engine: 220, unavailableCode: 0, transparent: 1, unidentified: 0, duplicateHex: 0 },
    ] as const;

    for (const item of expected) {
      expect(isBuiltinPaletteId(item.id)).toBe(true);
      if (!isBuiltinPaletteId(item.id)) throw new Error(`测试数据包含未知色板: ${item.id}`);
      const palette = getBuiltinPalette(item.id);
      const engineHexes = palette.engineColors.map((color) => color.hex);

      expect(palette.engineColors).toHaveLength(item.engine);
      expect(palette.engineColorCount).toBe(item.engine);
      expect(engineHexes.every((hex) => /^#[0-9A-F]{6}$/.test(hex))).toBe(true);
      expect(
        palette.engineColors.every(
          (color) =>
            typeof color.code === 'string' &&
            color.code.trim().length > 0 &&
            color.code.trim() !== '?' &&
            !/^UNKNOWN(?:[-_]|$)/i.test(color.code.trim()),
        ),
      ).toBe(true);
      expect(new Set(engineHexes).size).toBe(engineHexes.length);
      expect(palette.exclusions).toEqual({
        total: item.unavailableCode + item.transparent + item.unidentified + item.duplicateHex,
        unavailableCode: item.unavailableCode,
        transparent: item.transparent,
        unidentified: item.unidentified,
        duplicateHex: item.duplicateHex,
      });
      expect(palette.colors.filter((color) => color.excludedReason !== undefined)).toHaveLength(
        palette.exclusions.total,
      );
    }
  });

  it('同 HEX 多色号按上游顺序保留首个主色号', () => {
    const coco = getBuiltinPalette(versionedId('coco-291'));
    expect(coco.engineColors.find((color) => color.hex === '#FFFFFF')?.code).toBe('A01');
    expect(coco.engineColors.find((color) => color.hex === '#FFFDF7')?.code).toBe('A03');
    expect(coco.colors.find((color) => color.code === 'L14')?.excludedReason).toBe('duplicate-hex');
    expect(coco.colors.find((color) => color.code === 'A11')?.excludedReason).toBe('duplicate-hex');

    const manman = getBuiltinPalette(versionedId('manman-278'));
    expect(manman.engineColors.find((color) => color.hex === '#D093BC')?.code).toBe('S8');
    expect(manman.colors.find((color) => color.code === 'S9')?.excludedReason).toBe('duplicate-hex');
  });

  it('每套可生成色板的色号唯一，漫漫 S4/S7 映射正确', () => {
    for (const summary of listBuiltinPalettes()) {
      const codes = getBuiltinPalette(summary.id).engineColors.map((color) => color.code);
      expect(new Set(codes).size, summary.id).toBe(codes.length);
    }

    const manman = getBuiltinPalette('漫漫');
    expect(manman.engineColors.filter((color) => color.code === 'S4')).toEqual([
      expect.objectContaining({ code: 'S4', hex: '#7FCD9D' }),
    ]);
    expect(manman.engineColors.filter((color) => color.code === 'S7')).toEqual([
      expect.objectContaining({ code: 'S7', hex: '#F3C1C0' }),
    ]);
  });

  it('漫漫经典版来源摘要披露 S7 本地纠错', () => {
    expect(getBuiltinPalette('漫漫').source.qualitySummary).toContain(
      '上游记为 S4，豆谱按确认修正为 S7',
    );
  });
});

describe('内置色板数据完整性（spec §F6）', () => {
  it('291 个 hex 合法且唯一，每个品牌的可用色号也唯一', () => {
    const errors: string[] = [];
    const entries = Object.entries(sourceColorSystem);
    if (entries.length !== COLOR_SYSTEM_SIZE) {
      errors.push(`应有 ${COLOR_SYSTEM_SIZE} 个颜色，实际 ${entries.length}`);
    }
    for (const [hex, codes] of entries) {
      if (!/^#[0-9A-F]{6}$/i.test(hex)) errors.push(`非法 hex: ${hex}`);
      for (const brand of BRANDS) {
        if (typeof codes[brand] !== 'string') errors.push(`${hex} 缺少品牌 ${brand} 的取值`);
      }
    }
    for (const brand of BRANDS) {
      const seen = new Set<string>();
      for (const [hex, codes] of entries) {
        const code = codes[brand]?.trim();
        if (!code || code === '-') continue;
        if (seen.has(code)) errors.push(`品牌 ${brand} 色号重复: ${code}（出现于 ${hex}）`);
        seen.add(code);
      }
    }

    expect(errors).toEqual([]);
  });

  it('漫漫经确认的 S7 纠错已进入共享矩阵', () => {
    expect(sourceColorSystem['#7FCD9D']?.漫漫).toBe('S4');
    expect(sourceColorSystem['#F3C1C0']?.漫漫).toBe('S7');
  });

  it('每个品牌恰好 291 条映射', () => {
    for (const brand of BRANDS) {
      expect(getBuiltinPalette(brand).colors).toHaveLength(COLOR_SYSTEM_SIZE);
    }
  });
});

describe('经典目录的不可用色投影（E19）', () => {
  it('存在 "-" 的品牌（漫漫），其对应 hex 在可用色中被剔除', () => {
    // 上游数据中 #55514C 在漫漫品牌下为 "-"（无对应色号）
    const mmPalette = getBuiltinPalette('漫漫').colors;
    const target = mmPalette.find((c) => c.hex === '#55514C');
    expect(target).toBeDefined();
    expect(target!.code).toBeNull();

    const available = getBuiltinPalette('漫漫').engineColors;
    expect(available.find((c) => c.hex === '#55514C')).toBeUndefined();
    // 可用色数 = 291 - 缺失数
    const missing = mmPalette.filter((c) => c.code === null).length;
    expect(available).toHaveLength(COLOR_SYSTEM_SIZE - missing);
  });

  it('MARD 品牌无缺失色号', () => {
    const missing = getBuiltinPalette('MARD').colors.filter((c) => c.code === null);
    expect(missing).toHaveLength(0);
  });
});

describe('与上游 色号对应表.csv 交叉验证', () => {
  const csvPath = fileURLToPath(new URL('../../../tests/fixtures/color-system-table.csv', import.meta.url));
  // 上游 CSV 为 UTF-8 带 BOM 编码
  const bytes = readFileSync(csvPath);
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const header = lines[0].split(',');
  it('表头为五个品牌', () => {
    expect(header).toEqual(['MARD', 'COCO', '漫漫', '盼盼', '咪小窝']);
  });

  const rows = lines.slice(1).map((line) => line.split(','));

  it('行数与 JSON 数据一致（291 行）', () => {
    expect(rows).toHaveLength(COLOR_SYSTEM_SIZE);
  });

  it('除已批准的漫漫 S7 纠错外，每一行色号均与上游 CSV 一致', () => {
    // 以 MARD 色号为主键，从 JSON 反查 hex 与其余品牌色号
    const byMard = new Map<string, { hex: string; codes: Partial<Record<Brand, string>> }>();
    for (const [hex, codes] of Object.entries(sourceColorSystem)) {
      const mard = codes.MARD;
      if (mard && mard !== '-') byMard.set(mard, { hex, codes });
    }

    const discrepancies: string[] = [];
    let approvedCorrectionCount = 0;
    rows.forEach((row, index) => {
      const [mard, coco, mm, pp, mxw] = row;
      const entry = byMard.get(mard);
      if (!entry) {
        discrepancies.push(`第 ${index + 2} 行: CSV 中 MARD ${mard} 在 JSON 中不存在`);
        return;
      }
      const jsonCodes = entry.codes;
      const pairs: Array<[Brand, string]> = [
        ['COCO', coco],
        ['漫漫', mm],
        ['盼盼', pp],
        ['咪小窝', mxw],
      ];
      for (const [brand, csvCell] of pairs) {
        const jsonCode = (jsonCodes[brand] ?? '-').trim();
        if (brand === '漫漫' && entry.hex === '#F3C1C0') {
          expect(csvCell).toBe('S4');
          expect(jsonCode).toBe('S7');
          approvedCorrectionCount += 1;
          continue;
        }
        // 上游 CSV 个别单元格为多候选值（如 "157/70"），JSON 已选定其一；
        // 交叉验证接受「JSON 值 ∈ CSV 候选集」。
        const candidates = csvCell.split('/').map((s) => s.trim());
        if (!candidates.includes(jsonCode)) {
          discrepancies.push(
            `第 ${index + 2} 行 MARD ${mard} (${entry.hex}): 品牌 ${brand} CSV=${csvCell} JSON=${jsonCode}`,
          );
        }
      }
    });

    expect(approvedCorrectionCount).toBe(1);
    expect(discrepancies, `发现 ${discrepancies.length} 处不一致:\n${discrepancies.join('\n')}`).toHaveLength(0);
  });
});
