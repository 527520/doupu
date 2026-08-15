'use client';

/** 图纸预览（spec §F5 视图）：缩放/平移/网格/板缝/色号开关、悬停（桌面）与长按（移动）显示格信息。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import type { Pattern, PatternCell } from '@/lib/types';
import { drawPattern } from '@/lib/render/draw';
import { clampZoom, fitCellSize, pointToCell } from '@/lib/render/layout';

export interface CellHoverInfo {
  row: number;
  col: number;
  cell: PatternCell;
}

interface Props {
  pattern: Pattern;
  /** 测试钩子：固定初始格尺寸（默认按容器自适应） */
  defaultCellPx?: number;
  onCellHover?: (info: CellHoverInfo | null) => void;
}

export default function PatternPreview({ pattern, defaultCellPx, onCellHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showSeams, setShowSeams] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const dragState = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const baseCellPx = defaultCellPx ?? fitCellSize(pattern.width, pattern.height, 800, 560);
  const cellPx = Math.max(1, Math.round(baseCellPx * zoom));

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssW = pattern.width * cellPx;
    const cssH = pattern.height * cellPx;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPattern(ctx, pattern, { cellPx, showGrid, showSeams, showLabels });
  }, [pattern, cellPx, showGrid, showSeams, showLabels]);

  useEffect(() => {
    draw();
  }, [draw]);

  const emitHover = useCallback(
    (clientX: number, clientY: number): void => {
      if (!onCellHover) return;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = canvas.getBoundingClientRect();
      const info = pointToCell(
        clientX - rect.left + container.scrollLeft,
        clientY - rect.top + container.scrollTop,
        cellPx,
        0,
        0,
        pattern.width,
        pattern.height,
      );
      const cell = info ? pattern.cells[info.row * pattern.width + info.col] : null;
      onCellHover(info && cell ? { row: info.row, col: info.col, cell } : null);
    },
    [onCellHover, cellPx, pattern],
  );

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>): void => {
    e.preventDefault();
    if (e.shiftKey) {
      const container = containerRef.current;
      if (container) container.scrollLeft += e.deltaY;
    } else {
      setZoom((prev) => clampZoom(prev * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const container = containerRef.current;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: container?.scrollLeft ?? 0,
      offsetY: container?.scrollTop ?? 0,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') {
      longPressTimer.current = setTimeout(() => emitHover(e.clientX, e.clientY), 500);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (dragState.current) {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      const container = containerRef.current;
      if (container) {
        container.scrollLeft = dragState.current.offsetX - (e.clientX - dragState.current.startX);
        container.scrollTop = dragState.current.offsetY - (e.clientY - dragState.current.startY);
      }
    } else if (e.pointerType !== 'touch') {
      emitHover(e.clientX, e.clientY);
    }
  };

  const onPointerUp = (): void => {
    dragState.current = null;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // 手势被系统打断：停止拖拽、清理长按定时器
  const onPointerCancel = (): void => {
    dragState.current = null;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // 卸载时清理长按定时器
  useEffect(
    () => () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    },
    [],
  );

  const onPointerLeave = (): void => {
    if (!dragState.current) onCellHover?.(null);
  };

  const t = zhCN.preview;
  const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
    <label className="flex items-center gap-1 text-xs text-gray-600">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button type="button" aria-label={t.zoomOut} title={t.zoomOut} onClick={() => setZoom((z) => clampZoom(z / 1.25))} className="rounded border px-2 py-1 hover:bg-gray-50">
          −
        </button>
        <span role="status" aria-label={t.zoom}>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label={t.zoomIn} title={t.zoomIn} onClick={() => setZoom((z) => clampZoom(z * 1.25))} className="rounded border px-2 py-1 hover:bg-gray-50">
          +
        </button>
        <Toggle checked={showGrid} onChange={setShowGrid} label={t.showGrid} />
        <Toggle checked={showSeams} onChange={setShowSeams} label={t.showSeams} />
        <Toggle checked={showLabels} onChange={setShowLabels} label={t.showLabels} />
        <span className="text-gray-400">{t.panHint}</span>
      </div>
      <div ref={containerRef} className="overflow-auto rounded border border-gray-200 bg-gray-50 p-2">
        <canvas
          ref={canvasRef}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={onPointerLeave}
          style={{ touchAction: 'none', maxWidth: '100%' }}
        />
      </div>
    </div>
  );
}
