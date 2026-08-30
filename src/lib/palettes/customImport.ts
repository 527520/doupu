import type { CustomPaletteColor } from '@/lib/types';
import { LIMITS } from '@/lib/appInfo';
import { normalizeAvailableColorCode } from './availability';

export type CustomPaletteImportResult =
  | { ok: true; format: 'hex-list' | 'csv'; colors: CustomPaletteColor[] }
  | { ok: false; errors: string[] };

export interface CustomPaletteImportOptions {
  /** 编辑器当前已有的颜色；导入是追加操作，因此也必须参与重复和上限检查。 */
  existingColors?: readonly CustomPaletteColor[];
}

interface CsvRecord {
  fields: string[];
  line: number;
}

type CsvParseResult = { ok: true; records: CsvRecord[] } | { ok: false; errors: string[] };

const HEX = /^#?([0-9a-f]{6})$/i;

function normalizeHex(value: string): string | null {
  const match = HEX.exec(value.trim());
  return match ? `#${match[1].toUpperCase()}` : null;
}

/** RFC-4180-style records with physical source lines retained for diagnostics. */
function parseCsvRecords(text: string): CsvParseResult {
  const source = text.replace(/^\uFEFF/, '');
  const records: CsvRecord[] = [];
  const errors: string[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let quoted = false;
  let closedQuote = false;
  let recordHasCsvSyntax = false;

  const pushRecord = (): void => {
    fields.push(field);
    // 纯空行可忽略；但 `,,` / `"",""` 是实际 CSV 记录，
    // 必须交给严格行校验，不能伪装成空行被吞掉。
    if (recordHasCsvSyntax || fields.length > 1 || fields.some((value) => value.trim().length > 0)) {
      records.push({ fields, line: recordLine });
    }
    fields = [];
    field = '';
    closedQuote = false;
    recordHasCsvSyntax = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += char;
        if (char === '\n') line += 1;
      }
      continue;
    }

    if (char === '"') {
      recordHasCsvSyntax = true;
      if (field.length === 0 && !closedQuote) quoted = true;
      else errors.push(`第 ${line} 行：CSV 引号格式错误`);
      continue;
    }
    if (char === ',') {
      recordHasCsvSyntax = true;
      fields.push(field);
      field = '';
      closedQuote = false;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      pushRecord();
      line += 1;
      recordLine = line;
      continue;
    }
    if (closedQuote && !/\s/.test(char)) errors.push(`第 ${line} 行：CSV 引号后只能是分隔符`);
    else if (!closedQuote) field += char;
  }

  if (quoted) errors.push(`第 ${recordLine} 行：CSV 引号未闭合`);
  if (field.length > 0 || fields.length > 0 || recordHasCsvSyntax || closedQuote) pushRecord();
  return errors.length > 0 ? { ok: false, errors } : { ok: true, records };
}

function nextImportedCode(takenCodes: Set<string>): string {
  for (let value = 1; value <= 10000; value += 1) {
    const code = `C${String(value).padStart(3, '0')}`;
    if (!takenCodes.has(code)) return code;
  }
  // 自定义色板上限为 500，正常路径不会走到这里。
  throw new Error('无法生成唯一导入色号');
}

function parseHexList(
  records: CsvRecord[],
  existingColors: readonly CustomPaletteColor[],
): CustomPaletteImportResult {
  const colors: CustomPaletteColor[] = [];
  const errors: string[] = [];
  const firstHexLine = new Map<string, number>();
  const existingHexes = new Set(existingColors.map((color) => color.hex.trim().toUpperCase()));
  const takenCodes = new Set(existingColors.map((color) => color.code.trim().toUpperCase()));
  let limitReported = false;
  for (const record of records) {
    const hex = record.fields.length === 1 ? normalizeHex(record.fields[0]) : null;
    if (!hex) {
      errors.push(`第 ${record.line} 行：颜色必须是 #RRGGBB`);
      continue;
    }
    const duplicateLine = firstHexLine.get(hex);
    if (existingHexes.has(hex)) {
      errors.push(`第 ${record.line} 行：颜色 ${hex} 与当前色板重复`);
      continue;
    }
    if (duplicateLine !== undefined) {
      errors.push(`第 ${record.line} 行：颜色 ${hex} 重复（首次出现在第 ${duplicateLine} 行）`);
      continue;
    }
    firstHexLine.set(hex, record.line);
    if (existingColors.length + colors.length >= LIMITS.customPaletteColors) {
      if (!limitReported) errors.push(`第 ${record.line} 行：每块色板最多 ${LIMITS.customPaletteColors} 色`);
      limitReported = true;
      continue;
    }
    const code = nextImportedCode(takenCodes);
    takenCodes.add(code);
    colors.push({ code, hex });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, format: 'hex-list', colors };
}

function parseCsv(
  records: CsvRecord[],
  existingColors: readonly CustomPaletteColor[],
): CustomPaletteImportResult {
  const header = records[0].fields.map((value) => value.trim().toLowerCase());
  const codeIndex = header.indexOf('code');
  const hexIndex = header.indexOf('hex');
  if (codeIndex < 0 || hexIndex < 0) {
    return { ok: false, errors: [`第 ${records[0].line} 行：CSV 表头必须包含 code 和 hex`] };
  }
  if (header.filter((value) => value === 'code').length !== 1 || header.filter((value) => value === 'hex').length !== 1) {
    return { ok: false, errors: [`第 ${records[0].line} 行：CSV 表头 code 和 hex 各只能出现一次`] };
  }
  if (records.length === 1) {
    return { ok: false, errors: [`第 ${records[0].line} 行：CSV 至少需要一行颜色数据`] };
  }

  const colors: CustomPaletteColor[] = [];
  const errors: string[] = [];
  const firstCodeLine = new Map<string, number>();
  const firstHexLine = new Map<string, number>();
  const existingCodes = new Set(existingColors.map((color) => color.code.trim().toUpperCase()));
  const existingHexes = new Set(existingColors.map((color) => color.hex.trim().toUpperCase()));
  let limitReported = false;
  for (const record of records.slice(1)) {
    const code = (record.fields[codeIndex] ?? '').trim();
    const hex = normalizeHex(record.fields[hexIndex] ?? '');
    let valid = true;
    if (!code) errors.push(`第 ${record.line} 行：色号不能为空`);
    if (code && normalizeAvailableColorCode(code) === null) {
      errors.push(`第 ${record.line} 行：色号不能使用未识别占位符`);
      valid = false;
    }
    if (code.length > LIMITS.customPaletteCodeLength) {
      errors.push(`第 ${record.line} 行：色号最长 ${LIMITS.customPaletteCodeLength} 字符`);
      valid = false;
    }
    if (!hex) errors.push(`第 ${record.line} 行：颜色必须是 #RRGGBB`);
    if (!code || !hex) valid = false;
    if (code) {
      const normalizedCode = code.toUpperCase();
      const duplicateLine = firstCodeLine.get(normalizedCode);
      if (existingCodes.has(normalizedCode)) {
        errors.push(`第 ${record.line} 行：色号 ${code} 与当前色板重复`);
        valid = false;
      } else if (duplicateLine !== undefined) {
        errors.push(`第 ${record.line} 行：色号 ${code} 重复（首次出现在第 ${duplicateLine} 行）`);
        valid = false;
      } else {
        // 即使本行的其他字段不合法，也要保留其首次出现位置；
        // 否则后续同色号会被误当成首次出现。
        firstCodeLine.set(normalizedCode, record.line);
      }
    }
    if (hex) {
      const duplicateLine = firstHexLine.get(hex);
      if (existingHexes.has(hex)) {
        errors.push(`第 ${record.line} 行：颜色 ${hex} 与当前色板重复`);
        valid = false;
      } else if (duplicateLine !== undefined) {
        errors.push(`第 ${record.line} 行：颜色 ${hex} 重复（首次出现在第 ${duplicateLine} 行）`);
        valid = false;
      } else {
        firstHexLine.set(hex, record.line);
      }
    }
    if (valid && hex) {
      if (existingColors.length + colors.length >= LIMITS.customPaletteColors) {
        if (!limitReported) errors.push(`第 ${record.line} 行：每块色板最多 ${LIMITS.customPaletteColors} 色`);
        limitReported = true;
        continue;
      }
      colors.push({ code, hex });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, format: 'csv', colors };
}

/**
 * Parse a user-supplied custom palette without mutating the editor draft.
 * A failed import never returns partial colors, so callers can reject it atomically.
 */
export function parseCustomPaletteImport(
  text: string,
  options: CustomPaletteImportOptions = {},
): CustomPaletteImportResult {
  const parsed = parseCsvRecords(text);
  if (!parsed.ok) return parsed;
  if (parsed.records.length === 0) return { ok: false, errors: ['第 1 行：导入内容为空'] };
  const existingColors = options.existingColors ?? [];
  return parsed.records[0].fields.length > 1
    ? parseCsv(parsed.records, existingColors)
    : parseHexList(parsed.records, existingColors);
}
