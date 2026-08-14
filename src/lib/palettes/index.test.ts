import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COLOR_SYSTEM_SIZE,
  buildBrandPalette,
  getAvailableColors,
  lookupCode,
  normalizeCode,
  validateColorSystemData,
} from './index';
import { BRANDS, type Brand } from '@/lib/types';

describe('内置色板数据完整性（spec §F6）', () => {
  /**
   * 上游数据的已知缺陷（如实记录，不臆改数据）：
   * - 漫漫品牌下 #7FCD9D 与 #F3C1C0 共用色号 S4（色号对应表.csv 同样如此，
   *   系卖家色卡本身的重复）。匹配逻辑不受影响（两个 hex 都合法参与最近色匹配，
   *   仅图纸上会显示相同色号）。
   */
  const KNOWN_UPSTREAM_DEFECTS = ['品牌 漫漫 色号重复: S4（出现于 #F3C1C0）'];

  it('291 个 hex 合法且唯一（对象键天然唯一，验证数量与格式）', () => {
    expect([...validateColorSystemData()].sort()).toEqual([...KNOWN_UPSTREAM_DEFECTS].sort());
  });

  it('除已记录的上游缺陷外，无其他违规', () => {
    expect(validateColorSystemData()).toHaveLength(KNOWN_UPSTREAM_DEFECTS.length);
  });

  it('每个品牌恰好 291 条映射', () => {
    for (const brand of BRANDS) {
      expect(buildBrandPalette(brand)).toHaveLength(COLOR_SYSTEM_SIZE);
    }
  });
});

describe('色号归一化（"-" → null，E19）', () => {
  it('normalizeCode 规则', () => {
    expect(normalizeCode('-')).toBeNull();
    expect(normalizeCode('')).toBeNull();
    expect(normalizeCode('  ')).toBeNull();
    expect(normalizeCode(undefined)).toBeNull();
    expect(normalizeCode('A01')).toBe('A01');
  });

  it('存在 "-" 的品牌（漫漫），其对应 hex 在可用色中被剔除', () => {
    // 上游数据中 #55514C 在漫漫品牌下为 "-"（无对应色号）
    const mmPalette = buildBrandPalette('漫漫');
    const target = mmPalette.find((c) => c.hex === '#55514C');
    expect(target).toBeDefined();
    expect(target!.code).toBeNull();

    const available = getAvailableColors('漫漫');
    expect(available.find((c) => c.hex === '#55514C')).toBeUndefined();
    // 可用色数 = 291 - 缺失数
    const missing = mmPalette.filter((c) => c.code === null).length;
    expect(available).toHaveLength(COLOR_SYSTEM_SIZE - missing);
  });

  it('MARD 品牌无缺失色号', () => {
    const missing = buildBrandPalette('MARD').filter((c) => c.code === null);
    expect(missing).toHaveLength(0);
  });
});

describe('lookupCode', () => {
  it('按 hex 查色号，大小写不敏感', () => {
    expect(lookupCode('MARD', '#FAF4C8')).toBe('A01');
    expect(lookupCode('MARD', '#faf4c8')).toBe('A01');
    expect(lookupCode('MARD', '#000000')).toBe('H07');
    expect(lookupCode('MARD', '#123456')).toBeNull();
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

  it('每一行的五品牌色号与 JSON 映射一致（CSV 多候选值 "a/b" 以 JSON 取值为准）', () => {
    // 以 MARD 色号为主键，从 JSON 反查 hex 与其余品牌色号
    const byMard = new Map<string, { hex: string; codes: Partial<Record<Brand, string>> }>();
    for (const [hex, codes] of Object.entries(
      JSON.parse(readFileSync(fileURLToPath(new URL('./data/colorSystemMapping.json', import.meta.url)), 'utf8')),
    ) as Array<[string, Partial<Record<Brand, string>>]>) {
      const mard = codes.MARD;
      if (mard && mard !== '-') byMard.set(mard, { hex, codes });
    }

    const discrepancies: string[] = [];
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

    expect(discrepancies, `发现 ${discrepancies.length} 处不一致:\n${discrepancies.join('\n')}`).toHaveLength(0);
  });
});
