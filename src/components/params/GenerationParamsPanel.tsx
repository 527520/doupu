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

export default function GenerationParamsPanel({
  params,
  paletteOptions,
  selectedPalette,
  onParamsChange,
  onPaletteSelect,
}: Props) {
  const [local, setLocal] = useState<GenerationParams>(params);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [widthText, setWidthText] = useState(String(params.targetWidth));
  const [colorsText, setColorsText] = useState(String(params.targetColorCount));
  const firstRender = useRef(true);

  // 外部重置（换图/导入）时同步
  useEffect(() => {
    setLocal(params);
    setWidthText(String(params.targetWidth));
    setColorsText(String(params.targetColorCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.targetWidth, params.targetColorCount, params.mode, params.brightness, params.contrast, params.backgroundRemoval, params.bgTolerance, params.dithering]);

  // 防抖 300ms 上抛
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => onParamsChange(local), 300);
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
    <section aria-label={t.title} className="flex flex-col gap-4">
      <div>
        <label htmlFor="param-width" className="mb-1 block text-sm font-medium text-gray-700">
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
            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
      </div>

      <div>
        <label htmlFor="param-colors" className="mb-1 block text-sm font-medium text-gray-700">
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
            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={local.dithering}
          onChange={(e) => patch({ dithering: e.target.checked })}
        />
        {t.dithering}
      </label>

      <div className="mb-2 text-sm">
        <label htmlFor="param-brand" className="mb-1 block font-medium text-gray-700">
          {t.brand}
        </label>
        <select
          id="param-brand"
          value={paletteValue}
          onChange={(e) => onPaletteSelect(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
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
        className="text-left text-sm text-blue-600 underline-offset-4 hover:underline"
      >
        {t.advanced}
      </button>

      {advancedOpen && (
        <div className="flex flex-col gap-4 rounded border border-gray-200 p-3">
          <div>
            <label htmlFor="param-mode" className="mb-1 block text-sm text-gray-700">
              {t.sampleMode}
            </label>
            <select
              id="param-mode"
              value={local.mode}
              onChange={(e) => patch({ mode: e.target.value as 'dominant' | 'average' })}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
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
              <label htmlFor={`param-${key}`} className="mb-1 block text-sm text-gray-700">
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

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={local.backgroundRemoval}
              onChange={(e) => patch({ backgroundRemoval: e.target.checked })}
            />
            {t.backgroundRemoval}
          </label>

          {local.backgroundRemoval && (
            <div>
              <label htmlFor="param-bgtolerance" className="mb-1 block text-sm text-gray-700">
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
