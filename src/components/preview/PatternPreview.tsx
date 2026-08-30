'use client';

/** 图纸预览（spec §F5 视图）：缩放/平移/网格/板缝/色号开关、悬停（桌面）与长按（移动）显示格信息。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import type { Pattern, PatternCell } from '@/lib/types';
import { CANVAS_UI } from '@/lib/appInfo';
import { drawPattern } from '@/lib/render/draw';
import { BOARD_SIZE, clampZoom, fitCellSize, pointToCell } from '@/lib/render/layout';

export interface CellHoverInfo {
  row: number;
  col: number;
  cell: PatternCell;
}

interface Props {
  pattern: Pattern;
  boardSize?: number;
  /** 测试钩子：固定初始格尺寸（默认按容器自适应） */
  defaultCellPx?: number;
  onCellHover?: (info: CellHoverInfo | null) => void;
}

function PreviewToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-ink-soft">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export default function PatternPreview({ pattern, boardSize = BOARD_SIZE, defaultCellPx, onCellHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showSeams, setShowSeams] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const dragState = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 容器宽度自适应：格尺寸随容器（窄屏手机）等比计算，画布绝不拉伸变形
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth > 0 ? Math.floor(el.clientWidth) : null);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w > 0 ? Math.floor(w) : null);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 容器 p-2 两侧内边距；窄屏按实际可用宽度计算，画布宽高始终等比（常量见 CANVAS_UI）
  const baseCellPx =
    defaultCellPx ??
    fitCellSize(
      pattern.width,
      pattern.height,
      Math.max(1, (containerWidth ?? 800) - CANVAS_UI.containerPadding),
      CANVAS_UI.maxDisplayHeight,
    );
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
    drawPattern(ctx, pattern, { cellPx, boardSize, showGrid, showSeams, showLabels });
  }, [pattern, cellPx, boardSize, showGrid, showSeams, showLabels]);

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
    // 普通滚轮交给页面/滚动容器；仅显式的浏览器缩放手势调整图纸。
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((prev) => clampZoom(prev * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.pointerType === 'touch') {
      longPressTimer.current = setTimeout(() => emitHover(e.clientX, e.clientY), 500);
      return;
    }
    const container = containerRef.current;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: container?.scrollLeft ?? 0,
      offsetY: container?.scrollTop ?? 0,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.pointerType === 'touch') {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      return;
    }
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
    } else {
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

  return (
    <div className="flex flex-col gap-2">
      {/*
        D-8：350px 屏幕上这一行原本要放 9 个控件加一句 24 字提示，会折成 4–5 行
        把图纸挤出首屏。现在：缩放组与三个开关分两行排，长提示只在 sm 以上显示
        （小屏用户本来就靠手势，提示文字对他们没用）。
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="flex items-center gap-2">
          <button type="button" aria-label={t.zoomOut} title={t.zoomOut} onClick={() => setZoom((z) => clampZoom(z / 1.25))} className="btn-outline btn-icon">
            −
          </button>
          {/* 缩放百分比不是「状态播报」：原来的 role="status" 会让读屏在每次缩放时
              打断朗读（D-9 的 role 滥用）。可访问名仍是「缩放」，数值由文本提供。 */}
          <span aria-label={t.zoom} className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label={t.zoomIn} title={t.zoomIn} onClick={() => setZoom((z) => clampZoom(z * 1.25))} className="btn-outline btn-icon">
            +
          </button>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <PreviewToggle checked={showGrid} onChange={setShowGrid} label={t.showGrid} />
          <PreviewToggle checked={showSeams} onChange={setShowSeams} label={t.showSeams} />
          <PreviewToggle checked={showLabels} onChange={setShowLabels} label={t.showLabels} />
        </span>
        <span className="hidden text-ink-soft sm:inline">{t.panHint}</span>
      </div>
      <div ref={containerRef} className="overflow-auto rounded-2xl border border-lilac/40 bg-cream-deep/60 p-2">
        <canvas
          ref={canvasRef}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={onPointerLeave}
          /*
            D-9：canvas 对读屏是完全空白的，给出可访问名与图纸规模摘要；
            tabIndex 让键盘用户能把焦点落到图纸上（生成完成后我们也会聚焦这里）。
            D-5：pinch-zoom 交给浏览器——原来的 pan-x pan-y 把双指缩放禁掉了，
            手机上只能点 ± 看格子，与编辑画布的手势也不一致。
          */
          role="img"
          aria-label={t.canvasAria(pattern.width, pattern.height)}
          tabIndex={0}
          style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
        />
      </div>
    </div>
  );
}
