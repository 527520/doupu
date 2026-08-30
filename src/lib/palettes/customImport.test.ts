import { describe, expect, it } from 'vitest';
import { parseCustomPaletteImport } from './customImport';

describe('parseCustomPaletteImport', () => {
  it('兼容逐行 HEX，并规范化颜色与自动色号', () => {
    expect(parseCustomPaletteImport('\uFEFF#abcdef\r\n112233\r\n')).toEqual({
      ok: true,
      format: 'hex-list',
      colors: [
        { code: 'C001', hex: '#ABCDEF' },
        { code: 'C002', hex: '#112233' },
      ],
    });
  });

  it('逐行 HEX 任一坏行会整批拒绝并报告原始行号', () => {
    expect(parseCustomPaletteImport('#112233\nnot-a-color\n#445566')).toEqual({
      ok: false,
      errors: ['第 2 行：颜色必须是 #RRGGBB'],
    });
  });

  it('逐行 HEX 不把带引号的空字段当作可忽略物理空行', () => {
    expect(parseCustomPaletteImport('#112233\n""\n#445566')).toEqual({
      ok: false,
      errors: ['第 2 行：颜色必须是 #RRGGBB'],
    });
  });

  it('逐行 HEX 的重复颜色整批拒绝并报告重复行', () => {
    expect(parseCustomPaletteImport('#abcdef\nABCDEF')).toEqual({
      ok: false,
      errors: ['第 2 行：颜色 #ABCDEF 重复（首次出现在第 1 行）'],
    });
  });

  it('严格解析带 BOM、CRLF、quoted 字段和附加列的 code/hex CSV', () => {
    const csv = '\uFEFF"notes","hex","code"\r\n"warm, skin","#abcdef","A01"\r\n"plain","112233","B02"\r\n';
    expect(parseCustomPaletteImport(csv)).toEqual({
      ok: true,
      format: 'csv',
      colors: [
        { code: 'A01', hex: '#ABCDEF' },
        { code: 'B02', hex: '#112233' },
      ],
    });
  });

  it('CSV 的坏行与重复 code/hex 全部带行号并整批拒绝', () => {
    const csv = [
      'code,hex,notes',
      'A01,#111111,ok',
      'a01,#222222,duplicate code',
      'B02,#111111,duplicate hex',
      ',not-a-hex,broken',
    ].join('\n');
    expect(parseCustomPaletteImport(csv)).toEqual({
      ok: false,
      errors: [
        '第 3 行：色号 a01 重复（首次出现在第 2 行）',
        '第 4 行：颜色 #111111 重复（首次出现在第 2 行）',
        '第 5 行：色号不能为空',
        '第 5 行：颜色必须是 #RRGGBB',
      ],
    });
  });

  it('CSV 中有其他字段错误的行仍参与重复 code/hex 检查', () => {
    const csv = [
      'code,hex',
      'A01,broken',
      'a01,#112233',
      'B02,#112233',
    ].join('\n');
    expect(parseCustomPaletteImport(csv)).toEqual({
      ok: false,
      errors: [
        '第 2 行：颜色必须是 #RRGGBB',
        '第 3 行：色号 a01 重复（首次出现在第 2 行）',
        '第 4 行：颜色 #112233 重复（首次出现在第 3 行）',
      ],
    });
  });

  it('CSV 任一未知色号占位符都会带行号整批拒绝', () => {
    const csv = [
      'code,hex',
      'A01,#111111',
      '?,#222222',
      'UNKNOWN-01,#333333',
      'unknown_02,#444444',
    ].join('\n');
    expect(parseCustomPaletteImport(csv)).toEqual({
      ok: false,
      errors: [
        '第 3 行：色号不能使用未识别占位符',
        '第 4 行：色号不能使用未识别占位符',
        '第 5 行：色号不能使用未识别占位符',
      ],
    });
  });

  it('CSV 未闭合引号报告记录起始行', () => {
    expect(parseCustomPaletteImport('code,hex,notes\nA01,#112233,"broken\nvalue')).toEqual({
      ok: false,
      errors: ['第 2 行：CSV 引号未闭合'],
    });
  });

  it('空输入与只有表头的 CSV 都拒绝', () => {
    expect(parseCustomPaletteImport(' \r\n')).toEqual({ ok: false, errors: ['第 1 行：导入内容为空'] });
    expect(parseCustomPaletteImport('code,hex\r\n')).toEqual({
      ok: false,
      errors: ['第 1 行：CSV 至少需要一行颜色数据'],
    });
  });

  it('严格 CSV 不忽略由分隔符组成的坏行，且拒绝重复核心表头', () => {
    expect(parseCustomPaletteImport('code,hex\n,,')).toEqual({
      ok: false,
      errors: ['第 2 行：色号不能为空', '第 2 行：颜色必须是 #RRGGBB'],
    });
    expect(parseCustomPaletteImport('code,hex,code\nA01,#112233,ALIAS')).toEqual({
      ok: false,
      errors: ['第 1 行：CSV 表头 code 和 hex 各只能出现一次'],
    });
  });

  it('CSV 色号超限时在源行报告错误', () => {
    expect(parseCustomPaletteImport(`code,hex\n${'X'.repeat(21)},#112233`)).toEqual({
      ok: false,
      errors: ['第 2 行：色号最长 20 字符'],
    });
  });

  it('CSV 中任一占位色号都按物理行号整批拒绝', () => {
    const csv = [
      'code,hex',
      'A01,#112233',
      '?,#223344',
      'UNKNOWN,#334455',
      'UNKNOWN-01,#445566',
      'unknown_02,#556677',
    ].join('\n');
    expect(parseCustomPaletteImport(csv)).toEqual({
      ok: false,
      errors: [
        '第 3 行：色号不能使用未识别占位符',
        '第 4 行：色号不能使用未识别占位符',
        '第 5 行：色号不能使用未识别占位符',
        '第 6 行：色号不能使用未识别占位符',
      ],
    });
  });

  it('超过 500 色时在第一个超限行整批拒绝', () => {
    const colors = Array.from({ length: 501 }, (_, index) => `#${(index + 1).toString(16).padStart(6, '0')}`).join('\n');
    expect(parseCustomPaletteImport(colors)).toEqual({
      ok: false,
      errors: ['第 501 行：每块色板最多 500 色'],
    });
  });

  it('追加导入时与当前草稿重复也整批拒绝，并避让已有自动色号', () => {
    const existingColors = [{ code: 'C001', hex: '#FFFFFF' }];
    expect(parseCustomPaletteImport('#ffffff\n#112233', { existingColors })).toEqual({
      ok: false,
      errors: ['第 1 行：颜色 #FFFFFF 与当前色板重复'],
    });
    expect(parseCustomPaletteImport('#112233', { existingColors })).toEqual({
      ok: true,
      format: 'hex-list',
      colors: [{ code: 'C002', hex: '#112233' }],
    });
    expect(parseCustomPaletteImport('code,hex\nc001,#112233', { existingColors })).toEqual({
      ok: false,
      errors: ['第 2 行：色号 c001 与当前色板重复'],
    });
  });
});
