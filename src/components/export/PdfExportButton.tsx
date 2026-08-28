'use client';

/** PDF 导出按钮（spec §F7 PDF）：页数预览 + 确认后生成下载；空图纸给出错误提示。 */
import { useMemo, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import type { Pattern, PatternStatsItem } from '@/lib/types';
import { loadPdfCjkFont } from '@/lib/export/pdfFont';
import { buildExportFilename, computePdfLayout, paginateLegendItems, type PdfPageMetrics } from '@/lib/export/pdfLayout';
import { usePublicConfig } from '@/components/config/usePublicConfig';

export interface PdfExportButtonProps {
  name: string;
  pattern: Pattern;
  stats: PatternStatsItem[];
  disabled?: boolean;
}

/** 触发浏览器下载（导出为函数以便测试替换）。 */
export function triggerDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function PdfExportButton({ name, pattern, stats, disabled }: PdfExportButtonProps) {
  const t = zhCN.exportPdf;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 版式参数来自站点公开配置（票 02）：服务端环境变量可覆盖，改配置即生效
  const pubCfg = usePublicConfig();
  const metrics = useMemo<PdfPageMetrics>(
    () => ({
      cellMm: pubCfg.exportPdf.cellMm,
      marginMm: pubCfg.exportPdf.marginMm,
      headerMm: pubCfg.exportPdf.headerMm,
      pageCols: pubCfg.exportPdf.pageCols,
      pageRows: pubCfg.exportPdf.pageRows,
    }),
    [pubCfg],
  );

  const isEmpty = useMemo(
    () => !pattern.cells.some((cell) => !cell.transparent && !cell.external),
    [pattern],
  );
  const layout = useMemo(() => computePdfLayout(pattern.width, pattern.height, metrics), [pattern, metrics]);
  const legendPageCount = useMemo(() => paginateLegendItems(stats, metrics).length, [stats, metrics]);

  const onExportClick = (): void => {
    setError(null);
    if (isEmpty) {
      setError(t.emptyError);
      return;
    }
    setOpen(true);
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // 优化票 08：pdf-lib/fontkit（约 412KB）点击导出时才加载，不进首屏包
      // A-04：字体按本次要渲染的文本选择——设计名与色号都是常用字时只下载约 1MB 子集
      const pdfText = `${name}${stats.map((item) => item.code).join('')}`;
      const [{ generatePatternPdf }, fontBytes] = await Promise.all([
        import('@/lib/export/pdf'),
        loadPdfCjkFont(pdfText),
      ]);
      const bytes = await generatePatternPdf({ name, pattern, stats }, { fontBytes, metrics });
      triggerDownload(bytes, buildExportFilename(name, pattern.width, pattern.height, 'pdf'));
      setOpen(false);
    } catch {
      setError(t.failedError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onExportClick}
        disabled={disabled || busy}
        className="btn-outline btn-sm"
      >
        {busy ? t.generating : t.button}
      </button>

      {error && !open && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {open && (
        <section aria-label={t.dialogTitle} className="rounded-2xl border border-lilac/40 bg-white p-4 shadow-soft">
          <h3 className="mb-2 text-sm font-medium">{t.dialogTitle}</h3>
          <p className="text-sm text-ink">
            {layout.boards && layout.boards.rows * layout.boards.cols > 1
              ? t.boardPageCount(layout.boards.rows * layout.boards.cols, layout.gridPages.length, legendPageCount)
              : t.pageCount(layout.gridPages.length, legendPageCount)}
          </p>
          {layout.gridPages.length > 10 && <p className="mt-1 text-xs text-ink-soft">{t.largeHint}</p>}
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="btn-outline btn-sm"
            >
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy}
              className="btn-primary btn-sm"
            >
              {busy ? t.generating : t.confirm}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
