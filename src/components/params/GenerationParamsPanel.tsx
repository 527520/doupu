'use client';

/** 生成参数面板（spec §F3）：核心参数 + 高级折叠；300ms 防抖上抛；UI 层无法输入非法值。 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { zhCN } from '@/messages/zh-CN';
import type { Brand, GenerationParams } from '@/lib/types';
import { LIMITS } from '@/lib/appInfo';
import type { ImageDataLike } from '@/lib/engine/types';

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
  backgroundSampleSource?: ImageDataLike | null;
  disabled?: boolean;
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
    a.bgTolerance === b.bgTolerance &&
    (a.backgroundPrototype ?? null) === (b.backgroundPrototype ?? null)
  );
}

export default function GenerationParamsPanel({
  params,
  paletteOptions,
  selectedPalette,
  onParamsChange,
  onPaletteSelect,
  backgroundSampleSource,
  disabled,
}: Props) {
  const [local, setLocal] = useState<GenerationParams>(params);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [widthText, setWidthText] = useState(String(params.targetWidth));
  const [colorsText, setColorsText] = useState(String(params.targetColorCount));
  /** 最近一次已上抛（或已确认为当前外部值）的参数：跳过无变化的重复上抛（StrictMode 安全）。 */
  const lastEmittedRef = useRef<GenerationParams>(params);
  const samplerRef = useRef<HTMLCanvasElement>(null);

  // 外部重置（换图/导入/恢复设计）时同步
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- This controlled debounced editor must discard a rejected draft when the parent supplies a reset identity. */
    setLocal(params);
    setWidthText(String(params.targetWidth));
    setColorsText(String(params.targetColorCount));
    lastEmittedRef.current = params;
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [params]);

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
  const samplerWidth = backgroundSampleSource ? Math.min(240, backgroundSampleSource.width) : 0;
  const samplerHeight = backgroundSampleSource
    ? Math.max(1, Math.round((backgroundSampleSource.height * samplerWidth) / backgroundSampleSource.width))
    : 0;

  useEffect(() => {
    const source = backgroundSampleSource;
    const canvas = samplerRef.current;
    if (!source || !canvas || typeof ImageData === 'undefined') return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const backing = document.createElement('canvas');
    backing.width = source.width;
    backing.height = source.height;
    const backingContext = backing.getContext('2d');
    if (!backingContext) return;
    backingContext.putImageData(new ImageData(source.data.slice(), source.width, source.height), 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(backing, 0, 0, samplerWidth, samplerHeight);
  }, [backgroundSampleSource, samplerHeight, samplerWidth]);

  const sampleBackground = (event: MouseEvent<HTMLCanvasElement>): void => {
    const source = backgroundSampleSource;
    if (!source) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const x = Math.min(source.width - 1, Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * source.width)));
    const y = Math.min(source.height - 1, Math.max(0, Math.floor(((event.clientY - bounds.top) / bounds.height) * source.height)));
    const index = (y * source.width + x) * 4;
    const hex = `#${[source.data[index], source.data[index + 1], source.data[index + 2]]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`.toUpperCase();
    patch({ backgroundPrototype: hex });
  };

  return (
    <section aria-label={t.title} className="card-surface flex flex-col gap-4 p-4">
      <fieldset disabled={disabled} className="contents">
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
            <div className="flex flex-col gap-3">
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
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  checked={local.backgroundPrototype !== null && local.backgroundPrototype !== undefined}
                  onChange={(event) => patch({ backgroundPrototype: event.target.checked ? '#FFFFFF' : null })}
                />
                {t.manualBackground}
              </label>
              {local.backgroundPrototype && (
                <>
                  <label className="flex items-center justify-between gap-3 text-sm text-ink-soft">
                    {t.backgroundPrototype}
                    <input
                      type="color"
                      aria-label={t.backgroundPrototype}
                      value={local.backgroundPrototype}
                      onChange={(event) => patch({ backgroundPrototype: event.target.value.toUpperCase() })}
                      className="h-9 w-14 rounded-lg border border-lilac/50 bg-white p-1"
                    />
                  </label>
                  {backgroundSampleSource && (
                    <div className="flex flex-col gap-1 text-xs text-ink-soft">
                      <span>{t.backgroundPickHint}</span>
                      <canvas
                        ref={samplerRef}
                        width={samplerWidth}
                        height={samplerHeight}
                        aria-label={t.backgroundSampler}
                        onClick={sampleBackground}
                        className="max-h-40 max-w-full cursor-crosshair rounded-lg border border-lilac/50"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
      </fieldset>
    </section>
  );
}

export type { Brand };
