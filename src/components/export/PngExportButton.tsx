'use client';

/** PNG 导出按钮（spec §F7）：空图纸禁用并提示；导出失败可重试。 */
import { useMemo, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { contentBounds } from '@/lib/export/layout';
import { exportPngBlob } from '@/lib/export/png';
import type { Pattern } from '@/lib/types';

interface Props {
  pattern: Pattern;
  designName: string;
  cellPx?: number;
  cropToContent?: boolean;
  includeLegend?: boolean;
}

export default function PngExportButton({
  pattern,
  designName,
  cellPx,
  cropToContent,
  includeLegend,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const empty = useMemo(() => contentBounds(pattern) === null, [pattern]);

  const handleClick = async (): Promise<void> => {
    if (empty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await exportPngBlob(pattern, designName, { cellPx, cropToContent, includeLegend });
      if (!result.ok) {
        setError(result.code === 'EMPTY_PATTERN' ? zhCN.export.pngEmptyError : zhCN.export.pngFailed);
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
        onClick={() => void handleClick()}
        disabled={empty || busy}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {busy ? '…' : zhCN.export.pngExport}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
