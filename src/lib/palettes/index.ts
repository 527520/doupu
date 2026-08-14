/**
 * 内置色板数据模块（spec §F6）。
 * 数据出处：Zippland/perler-beads（AGPL-3.0），见 ./data/README.md 与根目录 NOTICE.md。
 */
import rawData from './data/colorSystemMapping.json';
import { BRANDS, type Brand, type PaletteColor } from '@/lib/types';

// 供 UI 层便捷引用（BRANDS 的权威定义在 types.ts）
export { BRANDS };

/** 原始数据形状：hex → 各品牌色号（"-" 表示该品牌无此色号）。 */
export type RawColorSystemMapping = Record<string, Partial<Record<Brand, string>>>;

const data = rawData as RawColorSystemMapping;

export const COLOR_SYSTEM_SIZE = 291;

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * 程序化完整性校验（spec §F6）。
 * 返回全部违规项；空数组表示数据完整。
 */
export function validateColorSystemData(input: RawColorSystemMapping = data): string[] {
  const errors: string[] = [];
  const entries = Object.entries(input);

  if (entries.length !== COLOR_SYSTEM_SIZE) {
    errors.push(`应有 ${COLOR_SYSTEM_SIZE} 个颜色，实际 ${entries.length}`);
  }

  for (const [hex, codes] of entries) {
    if (!HEX_PATTERN.test(hex)) {
      errors.push(`非法 hex: ${hex}`);
    }
    for (const brand of BRANDS) {
      if (typeof codes[brand] !== 'string') {
        errors.push(`${hex} 缺少品牌 ${brand} 的取值`);
      }
    }
  }

  for (const brand of BRANDS) {
    const seen = new Set<string>();
    for (const [hex, codes] of entries) {
      const code = codes[brand] ?? '-';
      if (code === '-' || code.trim() === '') continue;
      if (seen.has(code)) {
        errors.push(`品牌 ${brand} 色号重复: ${code}（出现于 ${hex}）`);
      }
      seen.add(code);
    }
  }

  return errors;
}

/** 归一化单个品牌的色号取值："-" 或空 → null。 */
export function normalizeCode(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' || trimmed === '-' ? null : trimmed;
}

/** 构建指定品牌的完整色板（291 色，无对应色号的 hex 其 code 为 null）。 */
export function buildBrandPalette(brand: Brand): PaletteColor[] {
  return Object.entries(data).map(([hex, codes]) => ({
    hex,
    code: normalizeCode(codes[brand]),
  }));
}

/**
 * 指定品牌的可用色列表（spec 边界 E19）：
 * 该品牌无对应色号的 hex 不可用于匹配。
 */
export function getAvailableColors(brand: Brand): PaletteColor[] {
  return buildBrandPalette(brand).filter((color) => color.code !== null);
}

/** 依据 hex 查询某个品牌下的色号；未知 hex 返回 null。 */
export function lookupCode(brand: Brand, hex: string): string | null {
  const entry = data[hex.toUpperCase()];
  if (!entry) return null;
  return normalizeCode(entry[brand]);
}
