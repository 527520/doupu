import { describe, expect, it } from 'vitest';
import generatedSnapshot from './data/pindou-color-data.generated.json';
import { analyzeEngineColors, verifyPalette } from '../../../scripts/import-pindou-color-data.mjs';

describe('pindou-color-data 导入分析', () => {
  it('只固化目录运行时需要的数据、来源清单和文件锁', () => {
    expect(Object.keys(generatedSnapshot).sort()).toEqual(['palettes', 'schema', 'source']);
    expect(Object.keys(generatedSnapshot.source).sort()).toEqual([
      'license',
      'licenseSha256',
      'manifestSha256',
      'repository',
      'revision',
    ]);

    for (const palette of generatedSnapshot.palettes) {
      expect(Object.keys(palette).sort()).toEqual([
        'analysis',
        'data',
        'id',
        'sourcePath',
        'sourceSha256',
      ]);
      expect(Object.keys(palette.analysis).sort()).toEqual(['engineColorCount', 'exclusions']);
      expect(Object.keys(palette.data).sort()).toEqual([
        'colors',
        'count',
        'market',
        'sources',
      ]);
      expect(Object.keys(palette.data.market).sort()).toEqual([
        'label',
        'score',
        'summary',
        'tier',
      ]);

      for (const source of palette.data.sources) {
        expect(Object.keys(source).sort()).toEqual(['id', 'notes', 'quality', 'url']);
      }
      for (const color of palette.data.colors) {
        expect(Object.keys(color)).toEqual(
          expect.arrayContaining(['code', 'group', 'hex', 'source']),
        );
        expect(
          Object.keys(color).every((key) =>
            [
              'code',
              'group',
              'hex',
              'notes',
              'original_code',
              'source',
              'transparency',
              'unidentified',
            ].includes(key),
          ),
        ).toBe(true);
      }
    }

    expect(JSON.stringify(generatedSnapshot)).not.toMatch(
      /"(?:rgb|groups|evidence|generated_at|rows_with_rgb|rows_without_rgb)":/,
    );
  });

  it('无条件排除 UNKNOWN、问号与透明色，并按顺序锁定重复 HEX 主色', () => {
    const analysis = analyzeEngineColors([
      { code: 'A01', hex: '#112233' },
      { code: 'A02', hex: '#112233' },
      { code: 'UNKNOWN-01', hex: '#445566' },
      { code: 'UNKNOWN_02', hex: '#556677' },
      { code: 'UNKNOWN', hex: '#667788' },
      { code: '?', hex: '#778899' },
      { code: 'CT01', hex: '#AABBCC80', transparency: 'transparent' },
    ]);

    expect(analysis).toEqual({
      engineColorCount: 1,
      exclusions: {
        total: 6,
        unavailableCode: 0,
        transparent: 1,
        unidentified: 4,
        duplicateHex: 1,
      },
      duplicateHexPrimaries: [
        { hex: '#112233', primaryCode: 'A01', duplicateCodes: ['A02'] },
      ],
    });
  });

  it('要求 HEX 与 RGB(A) 通道逐字节一致', () => {
    const palette = {
      schema: 'pindou-color-palette',
      id: 'fixture',
      count: 2,
      sources: [
        {
          id: 'src1',
          url: 'https://example.com/colors',
          quality: 'official_pdf',
          notes: 'fixture source',
        },
      ],
      colors: [
        { code: 'A01', hex: '#112233', rgb: [17, 34, 51], source: 'src1' },
        {
          code: 'T01',
          hex: '#AABBCC80',
          rgb: [170, 187, 204, 128],
          source: 'src1',
          transparency: 'transparent',
        },
      ],
    };
    const manifest = { count: 2, path: 'fixture', unidentified_count: 0 };

    expect(() => verifyPalette(palette, 'fixture', 2, manifest)).not.toThrow();
    expect(() =>
      verifyPalette(
        { ...palette, colors: [{ ...palette.colors[0], rgb: [17, 34, 52] }, palette.colors[1]] },
        'fixture',
        2,
        manifest,
      ),
    ).toThrow(/HEX.*RGB|RGB.*HEX/);
  });

  it('要求来源引用具有基本 schema，且每个颜色指向已声明来源', () => {
    const manifest = { count: 1, path: 'fixture', unidentified_count: 0 };
    const palette = {
      schema: 'pindou-color-palette',
      id: 'fixture',
      count: 1,
      sources: [
        {
          id: 'src1',
          url: 'https://example.com/colors',
          quality: 'official_pdf',
          notes: 'fixture source',
        },
      ],
      colors: [{ code: 'A01', hex: '#112233', rgb: [17, 34, 51], source: 'missing' }],
    };

    expect(() => verifyPalette(palette, 'fixture', 1, manifest)).toThrow(/来源/);
    expect(() =>
      verifyPalette(
        {
          ...palette,
          sources: [{ ...palette.sources[0], url: 'not-a-url' }],
          colors: [{ ...palette.colors[0], source: 'src1' }],
        },
        'fixture',
        1,
        manifest,
      ),
    ).toThrow(/来源/);
  });

  it('要求未知色使用一致的 UNKNOWN 标记，并与 manifest 计数一致', () => {
    const source = {
      id: 'src1',
      url: 'https://example.com/colors',
      quality: 'public_source',
      notes: 'fixture source',
    };
    const unknown = {
      code: 'UNKNOWN-01',
      original_code: '-',
      unidentified: true,
      hex: '#112233',
      rgb: [17, 34, 51],
      source: 'src1',
    };
    const palette = {
      schema: 'pindou-color-palette',
      id: 'fixture',
      count: 1,
      sources: [source],
      colors: [unknown],
    };

    expect(() =>
      verifyPalette(palette, 'fixture', 1, {
        count: 1,
        path: 'fixture',
        unidentified_count: 1,
      }),
    ).not.toThrow();
    expect(() =>
      verifyPalette(
        { ...palette, colors: [{ ...unknown, unidentified: false }] },
        'fixture',
        1,
        { count: 1, path: 'fixture', unidentified_count: 1 },
      ),
    ).toThrow(/UNKNOWN|未知/);
    expect(() =>
      verifyPalette(
        { ...palette, colors: [{ ...unknown, code: 'A01' }] },
        'fixture',
        1,
        { count: 1, path: 'fixture', unidentified_count: 1 },
      ),
    ).toThrow(/UNKNOWN|未知/);
    expect(() =>
      verifyPalette(
        { ...palette, colors: [{ ...unknown, original_code: '?' }] },
        'fixture',
        1,
        { count: 1, path: 'fixture', unidentified_count: 1 },
      ),
    ).toThrow(/original_code|原始/);
    expect(() =>
      verifyPalette(palette, 'fixture', 1, {
        count: 1,
        path: 'fixture',
        unidentified_count: 0,
      }),
    ).toThrow(/manifest|未知/);
  });
});
