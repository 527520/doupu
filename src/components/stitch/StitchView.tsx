'use client';

/**
 * 跟拼视图（G-1/G-2）：照着图纸一颗一颗拼时用的界面。
 *
 * 与「预览」「修补」的区别：这里不改图纸，只记录「拼到哪儿了」。
 * 设计要点（来自竞品与论坛反馈）：
 * - 点格子标记已拼／取消，已拼格子压暗并打勾；
 * - 整行标记：拼豆是一行一行推进的，逐格点 29 次不现实；
 * - 行列坐标常显（小屏尤其需要，否则数格子极易串行）；
 * - 「跳到下一未完成行」把当前行高亮，放下几天再回来也能立刻续上；
 * - 进度只存本机（Q13a）：不动项目文件格式与同步协议。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import Notice from '@/components/ui/Notice';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { contrastColor } from '@/lib/render/layout';
import { BOARD_SIZE } from '@/lib/export/pdfLayout';
import {
  clearProgress,
  setRowDone,
  summarizeProgress,
  toggleCell,
  type StitchProgress,
} from '@/lib/progress/stitchProgress';
import type { Pattern } from '@/lib/types';

interface Props {
  pattern: Pattern;
  progress: StitchProgress;
  onChange: (next: StitchProgress) => void;
}

/** 格子显示尺寸：小屏也要能点得中（≥18px），大图纸再往下压。 */
const MIN_CELL_PX = 18;
const MAX_CELL_PX = 30;
/** 坐标尺（行号/列号）占用的像素宽高 */
const RULER_PX = 22;

export default function StitchView({ pattern, progress, onChange }: Props) {
  const t = zhCN.stitch;
  const { confirm, confirmDialog } = useConfirm();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [focusRow, setFocusRow] = useState(0);
  const [cellPx, setCellPx] = useState(MIN_CELL_PX + 4);

  const summary = useMemo(() => summarizeProgress(progress, pattern.cells), [progress, pattern.cells]);

  const width = pattern.width * cellPx + RULER_PX;
  const height = pattern.height * cellPx + RULER_PX;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // 坐标尺（G-2）：列号在上、行号在左，常显不折叠
    ctx.font = `${Math.max(9, Math.floor(cellPx * 0.42))}px system-ui, sans-serif`;
    ctx.fillStyle = '#6b6276';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let col = 0; col < pattern.width; col++) {
      // 每 5 列与每块板的首列标数字，避免小格子上文字糊成一片
      if ((col + 1) % 5 !== 0 && col % BOARD_SIZE !== 0) continue;
      ctx.fillText(String(col + 1), RULER_PX + col * cellPx + cellPx / 2, RULER_PX / 2);
    }
    ctx.textAlign = 'right';
    for (let row = 0; row < pattern.height; row++) {
      if ((row + 1) % 5 !== 0 && row % BOARD_SIZE !== 0 && row !== focusRow) continue;
      ctx.fillStyle = row === focusRow ? '#b84f78' : '#6b6276';
      ctx.fillText(String(row + 1), RULER_PX - 4, RULER_PX + row * cellPx + cellPx / 2);
    }

    // 格子
    for (let row = 0; row < pattern.height; row++) {
      for (let col = 0; col < pattern.width; col++) {
        const index = row * pattern.width + col;
        const cell = pattern.cells[index];
        const x = RULER_PX + col * cellPx;
        const y = RULER_PX + row * cellPx;
        if (!cell || cell.transparent || cell.external || !cell.hex) continue;
        const done = progress.done[index] === 1;
        ctx.globalAlpha = done ? 0.28 : 1;
        ctx.fillStyle = cell.hex;
        ctx.fillRect(x, y, cellPx, cellPx);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellPx - 1, cellPx - 1);

        if (done) {
          // 已拼：打勾（用对比色，浅底黑勾、深底白勾）
          ctx.strokeStyle = contrastColor(cell.hex) === '#000000' ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';
          ctx.lineWidth = Math.max(1.5, cellPx * 0.12);
          ctx.beginPath();
          ctx.moveTo(x + cellPx * 0.24, y + cellPx * 0.52);
          ctx.lineTo(x + cellPx * 0.44, y + cellPx * 0.72);
          ctx.lineTo(x + cellPx * 0.78, y + cellPx * 0.3);
          ctx.stroke();
        } else if (cellPx >= 20 && cell.code) {
          ctx.fillStyle = contrastColor(cell.hex);
          ctx.textAlign = 'center';
          ctx.fillText(cell.code, x + cellPx / 2, y + cellPx / 2);
        }
      }
    }

    // 板缝线（每 29 格）：与打印版一致，方便按板对照
    ctx.strokeStyle = 'rgba(75,67,86,0.55)';
    ctx.lineWidth = 1.5;
    for (let col = BOARD_SIZE; col < pattern.width; col += BOARD_SIZE) {
      ctx.beginPath();
      ctx.moveTo(RULER_PX + col * cellPx, RULER_PX);
      ctx.lineTo(RULER_PX + col * cellPx, height);
      ctx.stroke();
    }
    for (let row = BOARD_SIZE; row < pattern.height; row += BOARD_SIZE) {
      ctx.beginPath();
      ctx.moveTo(RULER_PX, RULER_PX + row * cellPx);
      ctx.lineTo(width, RULER_PX + row * cellPx);
      ctx.stroke();
    }

    // 当前行高亮：放下几天回来也能立刻定位
    ctx.strokeStyle = '#b84f78';
    ctx.lineWidth = 2;
    ctx.strokeRect(RULER_PX, RULER_PX + focusRow * cellPx, pattern.width * cellPx, cellPx);
  }, [pattern, progress, cellPx, focusRow, width, height]);

  const cellFromEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>): { row: number; col: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left - RULER_PX;
    const y = event.clientY - bounds.top - RULER_PX;
    if (x < 0 || y < 0) return null;
    const col = Math.floor(x / cellPx);
    const row = Math.floor(y / cellPx);
    if (col < 0 || row < 0 || col >= pattern.width || row >= pattern.height) return null;
    return { row, col };
  }, [cellPx, pattern.height, pattern.width]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const hit = cellFromEvent(event);
    if (!hit) return;
    setFocusRow(hit.row);
    onChange(toggleCell(progress, hit.row, hit.col));
  };

  const markRow = (value: boolean): void => {
    onChange(setRowDone(progress, focusRow, value));
    // 标记整行完成后顺势前进一行——这是用户点这个按钮时的下一步动作。
    // （只在这里前进，不做「进度变化就自动跳」，否则会在用户还在本行时把视线带走。）
    if (value && focusRow < pattern.height - 1) setFocusRow(focusRow + 1);
  };

  const reset = async (): Promise<void> => {
    const ok = await confirm({
      title: t.resetTitle,
      message: t.resetMessage,
      confirmLabel: t.resetAction,
      danger: true,
    });
    if (ok) onChange(clearProgress(progress));
  };

  return (
    <section aria-label={t.title} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <p role="status" className="font-medium text-ink">
          {t.progress(summary.doneCount, summary.total, summary.percent)}
        </p>
        <span className="text-xs text-ink-soft">{t.rowLabel(focusRow + 1, pattern.height)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => markRow(true)} className="btn-primary btn-sm">
          {t.markRowDone}
        </button>
        <button type="button" onClick={() => markRow(false)} className="btn-outline btn-sm">
          {t.markRowUndone}
        </button>
        <button
          type="button"
          onClick={() => setFocusRow((row) => Math.max(0, row - 1))}
          className="btn-outline btn-xs"
        >
          {t.prevRow}
        </button>
        <button
          type="button"
          onClick={() => setFocusRow((row) => Math.min(pattern.height - 1, row + 1))}
          className="btn-outline btn-xs"
        >
          {t.nextRow}
        </button>
        {summary.nextRow !== null && (
          <button type="button" onClick={() => setFocusRow(summary.nextRow!)} className="btn-outline btn-xs">
            {t.jumpToPending(summary.nextRow + 1)}
          </button>
        )}
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          {t.cellSize}
          <input
            type="range"
            min={MIN_CELL_PX}
            max={MAX_CELL_PX}
            value={cellPx}
            onChange={(event) => setCellPx(Number(event.target.value))}
            aria-label={t.cellSize}
          />
        </label>
        <button type="button" onClick={() => void reset()} className="btn-danger-outline btn-xs">
          {t.reset}
        </button>
      </div>

      {summary.total > 0 && summary.doneCount === summary.total && (
        <Notice kind="success">{t.finished}</Notice>
      )}

      <div className="overflow-auto rounded-2xl border border-lilac/40 bg-white p-2">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          role="img"
          aria-label={t.canvasAria(pattern.width, pattern.height, summary.percent)}
          tabIndex={0}
          className="touch-pan-y"
          style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
        />
      </div>
      <p className="text-xs text-ink-soft">{t.hint}</p>
      {confirmDialog}
    </section>
  );
}
