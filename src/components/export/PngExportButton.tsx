'use client';

/** PNG 导出按钮（spec §F7 + 优化票 10）：空图纸禁用并提示；选项面板（格子大小/裁边/图例）。 */
import { useMemo, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { contentBounds, EXPORT_CELL_PX_CHOICES } from '@/lib/export/layout';
import { exportPngBlob } from '@/lib/export/png';
import { createPngArchiveBlob } from '@/lib/export/pngArchive';
import { createPngExportPlan, largestFittingPngCellPx } from '@/lib/export/pngPlan';
import type { Pattern } from '@/lib/types';
import { usePublicConfig } from '@/components/config/usePublicConfig';
import { track } from '@/lib/analytics/client';

interface Props {
  pattern: Pattern;
  designName: string;
  boardSize?: number;
  /** 测试/外部注入覆盖（优先于站点配置默认值） */
  cellPx?: number;
  cropToContent?: boolean;
  includeLegend?: boolean;
  disabled?: boolean;
  analyticsSource?: 'community' | 'other';
}

const OBJECT_URL_REVOKE_DELAY_MS = 1_500;

export default function PngExportButton({
  pattern,
  designName,
  boardSize,
  cellPx,
  cropToContent,
  includeLegend,
  disabled,
  analyticsSource = 'other',
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

  const fits = useMemo(
    () => new Map<number, boolean>(
      EXPORT_CELL_PX_CHOICES.map((size) => {
        const plan = createPngExportPlan(pattern, {
          cellPx: size,
          cropToContent: optCrop,
          includeLegend: optLegend,
        });
        return [size, plan.kind === 'single' || plan.kind === 'split'];
      }),
    ),
    [optCrop, optLegend, pattern],
  );
  const currentPlan = useMemo(
    () => createPngExportPlan(pattern, {
      cellPx: optCellPx,
      cropToContent: optCrop,
      includeLegend: optLegend,
    }),
    [optCellPx, optCrop, optLegend, pattern],
  );
  const suggestedCellPx = useMemo(
    () => largestFittingPngCellPx(pattern, EXPORT_CELL_PX_CHOICES, {
      cropToContent: optCrop,
      includeLegend: optLegend,
    }),
    [optCrop, optLegend, pattern],
  );
  const currentFits = currentPlan.kind === 'single' || currentPlan.kind === 'split';

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
        boardSize,
      });
      if (!result.ok) {
        track({ name: 'export_failed', properties: { format: 'png', errorCode: result.code } });
        if (result.code === 'EMPTY_PATTERN') setError(zhCN.export.pngEmptyError);
        else if (result.code === 'CANVAS_TOO_LARGE') setError(zhCN.export.pngTooLargeError(suggestedCellPx));
        else setError(zhCN.export.pngFailed);
        return;
      }
      let downloadBlob: Blob;
      let downloadName: string;
      if (result.kind === 'single') {
        downloadBlob = result.artifact.blob;
        downloadName = result.artifact.fileName;
      } else {
        downloadBlob = await createPngArchiveBlob([result.pattern, result.legend]);
        downloadName = result.archiveFileName;
      }
      const url = URL.createObjectURL(downloadBlob);
      let anchor: HTMLAnchorElement | null = null;
      try {
        anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = downloadName;
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor?.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
      }
      setOpen(false);
      track({ name: 'design_exported', properties: { format: 'png', source: analyticsSource } });
    } catch {
      setError(zhCN.export.pngFailed);
      track({ name: 'export_failed', properties: { format: 'png', errorCode: 'PNG_EXPORT_FAILED' } });
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
                {EXPORT_CELL_PX_CHOICES.map((size) => (
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
            {currentPlan.kind === 'split' && (
              <p role="status" className="text-xs text-ink-soft">
                {t.splitArchiveNotice}
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
