'use client';

/** 生成参数面板（spec §F3）：核心参数 + 高级折叠；300ms 防抖上抛；UI 层无法输入非法值。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import type { Brand, GenerationParams } from '@/lib/types';
import { LIMITS } from '@/lib/appInfo';

export interface PaletteOption {
  value: string;
  label: string;
  kind: 'builtin' | 'custom';
}

interface Props {
  params: GenerationParams;
  paletteOptions: PaletteOption[];
  selectedPalette: string;
  onParamsChange: (params: GenerationParams) => void;
  onPaletteSelect: (value: string) => void;
}

/** 参数浅比较（全部为原始字段）。 */
function paramsEqual(a: GenerationParams, b: GenerationParams): boolean {
  return (
    a.targetWidth === b.targetWidth &&
    a.targetColorCount === b.targetColorCount &&
    a.dithering === b.dithering &&
    a.mode === b.mode &&
    a.brightness === b.brightness &&
    a.contrast === b.contrast &&
    a.backgroundRemoval === b.backgroundRemoval &&
    a.bgTolerance === b.bgTolerance
  );
}

export default function GenerationParamsPanel({
  params,
  paletteOptions,
  selectedPalette,
  onParamsChange,
  onPaletteSelect,
}: Props) {  const [local, setLocal] = useState<GenerationParams>(params);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [widthText, setWidthText] = useState(String(params.targetWidth));
  const [colorsText, setColorsText] = useState(String(params.targetColorCount));
  /** 最近一次已上抛（或已确认为当前外部值）的参数：跳过无变化的重复上抛（StrictMode 安全）。 */
  const lastEmittedRef = useRef<GenerationParams>(params);

  // 外部重置（换图/导入/恢复设计）时同步
  useEffect(() => {
    setLocal(params);
    setWidthText(String(params.targetWidth));
    setColorsText(String(params.targetColorCount));
    lastEmittedRef.current = params;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.targetWidth, params.targetColorCount, params.mode, params.brightness, params.contrast, params.backgroundRemoval, params.bgTolerance, params.dithering]);

  // 防抖 300ms 上抛；与上次上抛值相同时不上抛（避免首挂载与回显的冗余 regenerate）
  useEffect(() => {
    if (paramsEqual(local, lastEmittedRef.current)) return;
    const timer = setTimeout(() => {
      lastEmittedRef.current = local;
      onParamsChange(local);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  const patch = (p: Partial<GenerationParams>) => setLocal((prev) => ({ ...prev, ...p }));

  const commitWidth = (): void => {
    const n = Number(widthText);
    if (!Number.isInteger(n) || n < LIMITS.targetWidth.min || n > LIMITS.targetWidth.max) {
      setWidthText(String(local.targetWidth)); // 回退到当前合法值
      return;
    }
    patch({ targetWidth: n });
  };

  const commitColors = (): void => {
    const n = Number(colorsText);
    if (!Number.isInteger(n) || n < LIMITS.targetColorCount.min || n > LIMITS.targetColorCount.max) {
      setColorsText(String(local.targetColorCount));
      return;
    }
    patch({ targetColorCount: n });
  };

  const paletteValue = useMemo(() => selectedPalette, [selectedPalette]);
  const t = zhCN.params;

  return (
    <section aria-label={t.title} className="card-surface flex flex-col gap-4 p-4">
      <div>
        <label htmlFor="param-width" className="mb-1 block text-sm font-medium text-ink-soft">
          {t.targetWidth}（{LIMITS.targetWidth.min}–{LIMITS.targetWidth.max}）
        </label>
        <div className="flex items-center gap-3">
          <input
            id="param-width"
            type="range"
            min={LIMITS.targetWidth.min}
            max={LIMITS.targetWidth.max}
            step={1}
            value={local.targetWidth}
            onChange={(e) => {
              const n = Number(e.target.value);
              patch({ targetWidth: n });
              setWidthText(String(n));
            }}
            className="flex-1"
          />
          <input
            type="number"
            inputMode="numeric"
            aria-label={t.targetWidth}
            value={widthText}
            min={LIMITS.targetWidth.min}
            max={LIMITS.targetWidth.max}
            onChange={(e) => setWidthText(e.target.value)}
            onBlur={commitWidth}
            onKeyDown={(e) => e.key === 'Enter' && commitWidth()}
            className="w-20 rounded-lg border border-lilac/50 px-2 py-1 text-sm text-ink"
          />
        </div>
      </div>

      <div>
        <label htmlFor="param-colors" className="mb-1 block text-sm font-medium text-ink-soft">
          {t.targetColorCount}（{LIMITS.targetColorCount.min}–{LIMITS.targetColorCount.max}）
        </label>
        <div className="flex items-center gap-3">
          <input
            id="param-colors"
            type="range"
            min={LIMITS.targetColorCount.min}
            max={LIMITS.targetColorCount.max}
            step={1}
            value={local.targetColorCount}
            onChange={(e) => {
              const n = Number(e.target.value);
              patch({ targetColorCount: n });
              setColorsText(String(n));
            }}
            className="flex-1"
          />
          <input
            type="number"
            inputMode="numeric"
            aria-label={t.targetColorCount}
            value={colorsText}
            min={LIMITS.targetColorCount.min}
            max={LIMITS.targetColorCount.max}
            onChange={(e) => setColorsText(e.target.value)}
            onBlur={commitColors}
            onKeyDown={(e) => e.key === 'Enter' && commitColors()}
            className="w-20 rounded-lg border border-lilac/50 px-2 py-1 text-sm text-ink"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input
          type="checkbox"
          checked={local.dithering}
          onChange={(e) => patch({ dithering: e.target.checked })}
        />
        {t.dithering}
      </label>

      <div className="mb-2 text-sm">
        <label htmlFor="param-brand" className="mb-1 block font-medium text-ink-soft">
          {t.brand}
        </label>
        <select
          id="param-brand"
          value={paletteValue}
          onChange={(e) => onPaletteSelect(e.target.value)}
          className="w-full rounded-lg border border-lilac/50 px-2 py-1.5 text-sm text-ink"
        >
          {paletteOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen((v) => !v)}
        aria-expanded={advancedOpen}
        className="link-soft text-left text-sm"
      >
        {t.advanced}
      </button>

      {advancedOpen && (
        <div className="flex flex-col gap-4 rounded-xl border border-lilac/30 bg-lilac-soft/40 p-3">
          <div>
            <label htmlFor="param-mode" className="mb-1 block text-sm text-ink-soft">
              {t.sampleMode}
            </label>
            <select
              id="param-mode"
              value={local.mode}
              onChange={(e) => patch({ mode: e.target.value as 'dominant' | 'average' })}
              className="w-full rounded-lg border border-lilac/50 px-2 py-1.5 text-sm text-ink"
            >
              <option value="dominant">{t.sampleDominant}</option>
              <option value="average">{t.sampleAverage}</option>
            </select>
          </div>

          {(
            [
              ['brightness', t.brightness, -100, 100],
              ['contrast', t.contrast, -100, 100],
            ] as const
          ).map(([key, label, min, max]) => (
            <div key={key}>
              <label htmlFor={`param-${key}`} className="mb-1 block text-sm text-ink-soft">
                {label}（{local[key]}）
              </label>
              <input
                id={`param-${key}`}
                type="range"
                min={min}
                max={max}
                step={1}
                value={local[key]}
                onChange={(e) => patch({ [key]: Number(e.target.value) } as Partial<GenerationParams>)}
                className="w-full"
              />
            </div>
          ))}

          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={local.backgroundRemoval}
              onChange={(e) => patch({ backgroundRemoval: e.target.checked })}
            />
            {t.backgroundRemoval}
          </label>

          {local.backgroundRemoval && (
            <div>
              <label htmlFor="param-bgtolerance" className="mb-1 block text-sm text-ink-soft">
                {t.bgTolerance}（{local.bgTolerance}）
              </label>
              <input
                id="param-bgtolerance"
                type="range"
                min={0}
                max={40}
                step={1}
                value={local.bgTolerance}
                onChange={(e) => patch({ bgTolerance: Number(e.target.value) })}
                className="w-full"
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export type { Brand };
