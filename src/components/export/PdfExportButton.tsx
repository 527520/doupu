'use client';

/** PDF 导出按钮（spec §F7 PDF）：页数预览 + 确认后生成下载；空图纸给出错误提示。 */
import { useMemo, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import type { Pattern, PatternStatsItem } from '@/lib/types';
import { loadPdfCjkFont } from '@/lib/export/pdfFont';
import { buildExportFilename, computePdfLayout, type PdfPageMetrics } from '@/lib/export/pdfLayout';
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
      const [{ generatePatternPdf }, fontBytes] = await Promise.all([
        import('@/lib/export/pdf'),
        loadPdfCjkFont(),
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
        className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? t.generating : t.button}
      </button>

      {error && !open && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {open && (
        <section aria-label={t.dialogTitle} className="rounded border border-gray-300 bg-white p-4 shadow-lg">
          <h3 className="mb-2 text-sm font-medium">{t.dialogTitle}</h3>
          <p className="text-sm text-gray-700">{t.pageCount(layout.gridPages.length)}</p>
          {layout.gridPages.length > 10 && <p className="mt-1 text-xs text-gray-500">{t.largeHint}</p>}
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
            >
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:bg-gray-100 disabled:text-gray-400"
            >
              {busy ? t.generating : t.confirm}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
