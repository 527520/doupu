'use client';

/** PNG 导出按钮（spec §F7 + 优化票 10）：空图纸禁用并提示；选项面板（格子大小/裁边/图例）。 */
import { useMemo, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { contentBounds, largestFittingCellPx, pngCellPxFits } from '@/lib/export/layout';
import { exportPngBlob } from '@/lib/export/png';
import type { Pattern } from '@/lib/types';
import { usePublicConfig } from '@/components/config/usePublicConfig';

interface Props {
  pattern: Pattern;
  designName: string;
  /** 测试/外部注入覆盖（优先于站点配置默认值） */
  cellPx?: number;
  cropToContent?: boolean;
  includeLegend?: boolean;
  disabled?: boolean;
}

const CELL_CHOICES = [8, 16, 24, 32, 48] as const;

export default function PngExportButton({
  pattern,
  designName,
  cellPx,
  cropToContent,
  includeLegend,
  disabled,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // 站点配置默认值（改环境变量即生效）；外部注入 props 优先
  const pubCfg = usePublicConfig();
  const defaultCellPx = cellPx ?? pubCfg.exportPng.cellPx;
  const defaultCrop = cropToContent ?? pubCfg.exportPng.cropToContent;
  const defaultLegend = includeLegend ?? pubCfg.exportPng.includeLegend;

  const [optCellPx, setOptCellPx] = useState<number>(defaultCellPx);
  const [optCrop, setOptCrop] = useState<boolean>(defaultCrop);
  const [optLegend, setOptLegend] = useState<boolean>(defaultLegend);
  const bounds = useMemo(() => contentBounds(pattern), [pattern]);
  const empty = bounds === null;

  /**
   * 每个格子档位是否放得下（A-03）：超限档位禁用并注明原因，
   * 而不是让用户选了之后拿到一句无信息量的「导出失败，请重试」。
   */
  const fitInput = useMemo(() => {
    const contentWidth = optCrop && bounds ? bounds.x1 - bounds.x0 + 1 : pattern.width;
    const contentHeight = optCrop && bounds ? bounds.y1 - bounds.y0 + 1 : pattern.height;
    const legendCount = optLegend ? new Set(
      pattern.cells.filter((cell) => !cell.transparent && !cell.external).map((cell) => cell.code),
    ).size : 0;
    return { contentWidth, contentHeight, legendCount };
  }, [bounds, optCrop, optLegend, pattern]);

  const fits = useMemo(
    () => new Map<number, boolean>(
      CELL_CHOICES.map((size) => [size, pngCellPxFits({ ...fitInput, cellPx: size })]),
    ),
    [fitInput],
  );
  const suggestedCellPx = useMemo(() => largestFittingCellPx(CELL_CHOICES, fitInput), [fitInput]);
  const currentFits = fits.get(optCellPx) ?? true;

  const t = zhCN.exportPng;

  const handleClick = (): void => {
    if (disabled || empty || busy) return;
    setError(null);
    setOptCellPx(defaultCellPx);
    setOptCrop(defaultCrop);
    setOptLegend(defaultLegend);
    setOpen(true);
  };

  const confirm = async (): Promise<void> => {
    if (disabled || empty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await exportPngBlob(pattern, designName, {
        cellPx: optCellPx,
        cropToContent: optCrop,
        includeLegend: optLegend,
      });
      if (!result.ok) {
        if (result.code === 'EMPTY_PATTERN') setError(zhCN.export.pngEmptyError);
        else if (result.code === 'CANVAS_TOO_LARGE') setError(zhCN.export.pngTooLargeError(suggestedCellPx));
        else setError(zhCN.export.pngFailed);
        return;
      }
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch {
      setError(zhCN.export.pngFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || empty || busy}
        className="btn-primary btn-sm"
      >
        {busy ? '…' : zhCN.export.pngExport}
      </button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {open && (
        <section aria-label={t.dialogTitle} className="rounded-2xl border border-lilac/40 bg-white p-3 shadow-soft">
          <h3 className="mb-2 text-sm font-medium">{t.dialogTitle}</h3>
          <div className="flex flex-col gap-2 text-sm">
            <label htmlFor="png-cellpx" className="flex items-center justify-between gap-2 text-ink-soft">
              {t.cellSize}
              <select
                id="png-cellpx"
                value={optCellPx}
                onChange={(e) => setOptCellPx(Number(e.target.value))}
                className="input-compact"
              >
                {CELL_CHOICES.map((size) => (
                  <option key={size} value={size} disabled={!fits.get(size)}>
                    {fits.get(size) ? t.cellSizeValue(size) : t.cellSizeTooLarge(size)}
                  </option>
                ))}
              </select>
            </label>
            {!currentFits && (
              <p role="alert" className="text-xs text-danger">
                {zhCN.export.pngTooLargeError(suggestedCellPx)}
              </p>
            )}
            <label className="flex items-center gap-2 text-ink-soft">
              <input type="checkbox" checked={optCrop} onChange={(e) => setOptCrop(e.target.checked)} />
              {t.cropToContent}
            </label>
            <label className="flex items-center gap-2 text-ink-soft">
              <input type="checkbox" checked={optLegend} onChange={(e) => setOptLegend(e.target.checked)} />
              {t.includeLegend}
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="btn-outline btn-sm"
            >
              {zhCN.designs.cancel}
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || !currentFits}
              className="btn-primary btn-sm"
            >
              {t.confirm}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
