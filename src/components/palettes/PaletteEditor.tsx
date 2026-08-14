'use client';

/** 自定义色板编辑器（spec §F6 / 边界 E20）：逐行录入 + 即时校验 + 粘贴/文件导入 + 复制自品牌。 */
import { useMemo, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { BRANDS, buildBrandPalette } from '@/lib/palettes';
import { customPaletteColorsSchema, designNameSchema } from '@/lib/schemas';
import { LIMITS } from '@/lib/appInfo';
import type { CustomPaletteColor } from '@/lib/types';

export interface EditorRow {
  code: string;
  hex: string;
}

interface Props {
  initialName: string;
  initialColors: CustomPaletteColor[];
  saving?: boolean;
  onSave: (name: string, colors: CustomPaletteColor[]) => Promise<void> | void;
  onCancel: () => void;
}

/** 从文本解析十六进制颜色列表（每行一个，可带 #，大小写不敏感）。 */
export function parseHexList(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(line.trim());
    if (match) out.push(`#${match[1].toUpperCase()}`);
  }
  return out;
}

/** 生成不与现有色号冲突的自动色号（C001…）。 */
export function nextAutoCode(rows: EditorRow[]): string {
  const taken = new Set(rows.map((row) => row.code.trim().toUpperCase()));
  for (let n = 1; n <= 10000; n++) {
    const candidate = `C${String(n).padStart(3, '0')}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `C${Date.now().toString(36)}`;
}

/** 行级校验：返回「行下标 → 错误消息」与全局错误（空板/超上限）。 */
export function validateRows(rows: EditorRow[]): { rowErrors: Map<number, string>; global: string | null } {
  const rowErrors = new Map<number, string>();
  const parsed = customPaletteColorsSchema.safeParse(rows);
  if (parsed.success) return { rowErrors, global: null };
  for (const issue of parsed.error.issues) {
    const index = typeof issue.path[0] === 'number' ? issue.path[0] : -1;
    if (index >= 0) {
      if (!rowErrors.has(index)) rowErrors.set(index, issue.message);
    } else {
      // 数组级错误（min/max）直接作为全局错误返回
      return { rowErrors, global: issue.message };
    }
  }
  return { rowErrors, global: null };
}

export default function PaletteEditor({ initialName, initialColors, saving, onSave, onCancel }: Props) {
  const t = zhCN.palettes.editor;
  const [name, setName] = useState(initialName);
  const [rows, setRows] = useState<EditorRow[]>(
    initialColors.length > 0 ? initialColors.map((c) => ({ code: c.code, hex: c.hex })) : [{ code: 'C001', hex: '#FFFFFF' }],
  );
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const { rowErrors, global } = useMemo(() => validateRows(rows), [rows]);
  const nameError = useMemo(() => {
    const result = designNameSchema.safeParse(name);
    return result.success ? null : result.error.issues[0]?.message ?? null;
  }, [name]);
  const canSave = rowErrors.size === 0 && global === null && nameError === null && !saving;

  const setRow = (index: number, patch: Partial<EditorRow>): void => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = (): void => {
    if (rows.length >= LIMITS.customPaletteColors) return;
    setRows((prev) => [...prev, { code: nextAutoCode(prev), hex: '#FFFFFF' }]);
  };

  const removeRow = (index: number): void => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const appendHexes = (hexes: string[]): void => {
    if (hexes.length === 0) {
      setImportError(t.importFailed);
      return;
    }
    setImportError(null);
    setRows((prev) => {
      const existing = new Set(prev.map((row) => row.hex.toUpperCase()));
      const additions: EditorRow[] = [];
      for (const hex of hexes) {
        if (existing.has(hex) || additions.length + prev.length >= LIMITS.customPaletteColors) continue;
        existing.add(hex);
        additions.push({ code: nextAutoCode([...prev, ...additions]), hex });
      }
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  };

  const doPasteImport = (): void => {
    appendHexes(parseHexList(pasteText));
    setPasteText('');
    setPasteOpen(false);
  };

  const doFileImport = async (file: File | null): Promise<void> => {
    if (!file) return;
    try {
      const text = await file.text();
      appendHexes(parseHexList(text));
    } catch {
      setImportError(t.importFailed);
    }
  };

  const copyFromBrand = (brandValue: string): void => {
    const brand = BRANDS.find((b) => b === brandValue);
    if (!brand) return;
    if (rows.length > 1 && typeof window !== 'undefined' && !window.confirm(t.copyConfirm)) return;
    const palette = buildBrandPalette(brand);
    const next: EditorRow[] = palette.map((color, index) => ({
      code: color.code ?? `C${String(index + 1).padStart(3, '0')}`,
      hex: color.hex,
    }));
    setRows(next);
    setImportError(null);
  };

  const submit = (): void => {
    if (!canSave) return;
    void onSave(name.trim(), rows.map((row) => ({ code: row.code.trim(), hex: row.hex.toUpperCase() })));
  };

  return (
    <section aria-label={t.title} className="flex flex-col gap-4 rounded border border-gray-300 bg-white p-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-gray-700">{t.name}</span>
        <input
          type="text"
          value={name}
          maxLength={LIMITS.designNameLength}
          onChange={(e) => setName(e.target.value)}
          aria-label={t.name}
          aria-invalid={nameError !== null}
          className="rounded border border-gray-300 px-2 py-1"
        />
        {nameError && <span role="alert" className="text-xs text-red-600">{nameError}</span>}
      </label>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span aria-label={t.colorsCounter(rows.length)} className="text-xs text-gray-500">
          {t.colorsCounter(rows.length)}
        </span>
        <button type="button" onClick={addRow} disabled={rows.length >= LIMITS.customPaletteColors} className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50">
          {t.addRow}
        </button>
        <button type="button" onClick={() => setPasteOpen((v) => !v)} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">
          {t.pasteImport}
        </button>
        <label className="rounded border px-2 py-1 text-xs hover:bg-gray-50">
          {t.fileImport}
          <input
            type="file"
            accept=".txt,.csv,text/plain"
            className="sr-only"
            aria-label={t.fileImport}
            onChange={(e) => {
              void doFileImport(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </label>
        <select
          value=""
          onChange={(e) => copyFromBrand(e.target.value)}
          aria-label={t.copyFromBrand}
          className="rounded border px-2 py-1 text-xs"
        >
          <option value="" disabled>
            {t.copyFromBrand}
          </option>
          {BRANDS.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
      </div>

      {importError && <p role="alert" className="text-xs text-red-600">{importError}</p>}

      {pasteOpen && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-gray-500">{t.pasteHint}</p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            aria-label={t.pasteImport}
            className="rounded border border-gray-300 p-2 font-mono text-xs"
          />
          <div className="flex gap-2">
            <button type="button" onClick={doPasteImport} className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700">
              {t.pasteImport}
            </button>
            <button type="button" onClick={() => setPasteOpen(false)} className="rounded border px-3 py-1 text-xs hover:bg-gray-50">
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="max-h-80 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="pb-1 font-medium">{t.code}</th>
              <th className="pb-1 font-medium">{t.hex}</th>
              <th className="pb-1 w-16" aria-label={t.removeRow} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className={rowErrors.has(index) ? 'bg-red-50' : undefined}>
                <td className="py-1 pr-2">
                  <input
                    type="text"
                    value={row.code}
                    maxLength={LIMITS.customPaletteCodeLength}
                    onChange={(e) => setRow(index, { code: e.target.value })}
                    aria-label={`${t.code} ${index + 1}`}
                    aria-invalid={rowErrors.has(index)}
                    className="w-28 rounded border border-gray-300 px-1 py-0.5 text-xs"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="text"
                    value={row.hex}
                    onChange={(e) => setRow(index, { hex: e.target.value })}
                    aria-label={`${t.hex} ${index + 1}`}
                    aria-invalid={rowErrors.has(index)}
                    className="w-28 rounded border border-gray-300 px-1 py-0.5 font-mono text-xs"
                  />
                </td>
                <td className="py-1">
                  <button type="button" onClick={() => removeRow(index)} aria-label={`${t.removeRow} ${index + 1}`} className="text-xs text-red-600 hover:underline">
                    ×
                  </button>
                  {rowErrors.get(index) && (
                    <p role="alert" className="text-xs text-red-600">{rowErrors.get(index)}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {global && <p role="alert" className="text-sm text-red-600">{global}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50">
          {t.cancel}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {saving ? '…' : t.save}
        </button>
      </div>
    </section>
  );
}
