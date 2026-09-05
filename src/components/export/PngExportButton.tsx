'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import Switch from '@/components/ui/Switch';

/** PNG 导出按钮（spec §F7 + 优化票 10）：空图纸禁用并提示；选项面板（格子大小/裁边/图例）。 */
import { useId, useMemo, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { EXPORT_CELL_PX_CHOICES } from '@/lib/export/layout';
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
  const pending = useRef(false);
  const optionsId = useId();
  // 站点配置默认值（改环境变量即生效）；外部注入 props 优先
  const pubCfg = usePublicConfig();
  const defaultCellPx = cellPx ?? pubCfg.exportPng.cellPx;
  const defaultCrop = cropToContent ?? pubCfg.exportPng.cropToContent;
  const defaultLegend = includeLegend ?? pubCfg.exportPng.includeLegend;

  const [optCellPx, setOptCellPx] = useState<number>(defaultCellPx);
  const [optCrop, setOptCrop] = useState<boolean>(defaultCrop);
  const [optLegend, setOptLegend] = useState<boolean>(defaultLegend);
  const defaultPlan = useMemo(() => createPngExportPlan(pattern, {
    cellPx: defaultCellPx, cropToContent: defaultCrop, includeLegend: defaultLegend,
  }), [pattern, defaultCellPx, defaultCrop, defaultLegend]);
  const empty = defaultPlan.kind === 'empty';

  // 尚未打开的选项不逐档遍历图纸；首次生成优先提交画布与制作控件。
  // 快捷下载仍立即使用同一规划器预检，打开选项后再计算全部合法档位。
  const fits = useMemo(
    () => new Map<number, boolean>(
      (open ? EXPORT_CELL_PX_CHOICES : []).map((size) => {
        const plan = createPngExportPlan(pattern, {
          cellPx: size,
          cropToContent: optCrop,
          includeLegend: optLegend,
        });
        return [size, plan.kind === 'single' || plan.kind === 'split'];
      }),
    ),
    [open, optCrop, optLegend, pattern],
  );
  const currentPlan = useMemo(
    () => open ? createPngExportPlan(pattern, {
      cellPx: optCellPx,
      cropToContent: optCrop,
      includeLegend: optLegend,
    }) : defaultPlan,
    [open, optCellPx, optCrop, optLegend, pattern, defaultPlan],
  );
  const suggestedCellPx = useMemo(
    () => open ? largestFittingPngCellPx(pattern, EXPORT_CELL_PX_CHOICES, {
      cropToContent: optCrop,
      includeLegend: optLegend,
    }) : null,
    [open, optCrop, optLegend, pattern],
  );
  const currentFits = currentPlan.kind === 'single' || currentPlan.kind === 'split';
  const defaultFits = defaultPlan.kind === 'single' || defaultPlan.kind === 'split';

  const t = zhCN.exportPng;

  const handleClick = (): void => {
    if (disabled || empty || busy) return;
    setError(null);
    setOptCellPx(defaultCellPx);
    setOptCrop(defaultCrop);
    setOptLegend(defaultLegend);
    setOpen(true);
  };

  const confirm = async (defaults = false): Promise<void> => {
    if (disabled || empty || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await exportPngBlob(pattern, designName, {
        cellPx: defaults ? defaultCellPx : optCellPx,
        cropToContent: defaults ? defaultCrop : optCrop,
        includeLegend: defaults ? defaultLegend : optLegend,
        boardSize,
      });
      if (!result.ok) {
        track({ name: 'export_failed', properties: { format: 'png', errorCode: result.code } });
        if (result.code === 'EMPTY_PATTERN') setError(zhCN.export.pngEmptyError);
        else if (result.code === 'CANVAS_TOO_LARGE') setError(zhCN.export.pngTooLargeError(suggestedCellPx ?? largestFittingPngCellPx(pattern, EXPORT_CELL_PX_CHOICES, {
          cropToContent: defaults ? defaultCrop : optCrop,
          includeLegend: defaults ? defaultLegend : optLegend,
        })));
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
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="export-primary-actions"><button type="button" onClick={() => void confirm(true)} disabled={disabled || !defaultFits || busy} className="btn-primary btn-sm">{busy ? t.working : t.quickDownload}</button>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || empty || busy}
        className="btn-outline btn-sm"
        aria-expanded={open}
      >
        {t.options}
      </button></div>
      {defaultPlan.kind === 'split' && !open && <p className="text-xs text-ink-soft">{t.splitArchiveNotice}</p>}
      {defaultPlan.kind === 'too-large' && !open && <p className="text-xs text-ink-soft">{t.defaultTooLarge}</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {open && (
        <section aria-label={t.dialogTitle} className="rounded-2xl border border-lilac/40 bg-white p-3 shadow-soft">
          <h3 className="mb-2 text-sm font-medium">{t.dialogTitle}</h3>
          <div className="flex flex-col gap-2 text-sm">
              <ResponsiveSelect label={t.cellSize}
                id={optionsId}
                disabled={busy}
                value={String(optCellPx)}
                onValueChange={(value) => setOptCellPx(Number(value))}
                options={EXPORT_CELL_PX_CHOICES.map(size=>({value:String(size),label:fits.get(size)?t.cellSizeValue(size):t.cellSizeTooLarge(size),disabled:!fits.get(size)}))}
              />
            {!currentFits && (
              <p role="alert" className="text-xs text-danger">
                {zhCN.export.pngTooLargeError(suggestedCellPx ?? defaultCellPx)}
              </p>
            )}
            {currentPlan.kind === 'split' && (
              <p role="status" className="text-xs text-ink-soft">
                {t.splitArchiveNotice}
              </p>
            )}
            <Switch label={t.cropToContent} checked={optCrop} disabled={busy} onChange={setOptCrop} />
            <Switch label={t.includeLegend} checked={optLegend} disabled={busy} onChange={setOptLegend} />
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
