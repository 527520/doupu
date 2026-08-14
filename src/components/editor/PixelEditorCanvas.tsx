'use client';

/**
 * 像素编辑画布（spec §F5）：画笔/橡皮/油漆桶/吸管/替换/清除 + 撤销重做 + 快捷键 + 触屏。
 * 图纸保存在 ref 中命令式修改（200×200 单操作 <50ms），画布随版本号重绘。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import EditorToolbar from './EditorToolbar';
import { zhCN } from '@/messages/zh-CN';
import type { PaletteColor, Pattern, PatternStatsItem } from '@/lib/types';
import { drawPattern } from '@/lib/render/draw';
import { fitCellSize, pointToCell } from '@/lib/render/layout';
import { EditHistory } from '@/lib/editor/history';
import {
  applyBrush,
  applyErase,
  clearAll,
  floodFill,
  replaceByCode,
  type BrushSize,
  type EditSnapshot,
  type ToolId,
} from '@/lib/editor/ops';
import { createEditorState, refreshStats } from '@/lib/editor/state';

const LONG_PRESS_MS = 500;
const MOVE_THRESHOLD_PX = 6;

interface Props {
  pattern: Pattern;
  palette: PaletteColor[];
  /** 测试钩子：固定格像素尺寸 */
  defaultCellPx?: number;
  onStatsChange?: (stats: PatternStatsItem[], total: number) => void;
  onColorChange?: (color: PaletteColor | null) => void;
}

export default function PixelEditorCanvas({
  pattern,
  palette,
  defaultCellPx,
  onStatsChange,
  onColorChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(createEditorState(pattern));
  const historyRef = useRef(new EditHistory());

  const [tool, setToolState] = useState<ToolId>('brush');
  const [brushSize, setBrushSizeState] = useState<BrushSize>(1);
  const [currentColor, setCurrentColorState] = useState<PaletteColor | null>(palette[0] ?? null);
  const [cursor, setCursor] = useState<{ row: number; col: number } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [version, setVersion] = useState(0);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceFrom, setReplaceFrom] = useState('');
  const [replaceTo, setReplaceTo] = useState('0');
  const [replaceMsg, setReplaceMsg] = useState<string | null>(null);

  const toolRef = useRef(tool);
  const brushSizeRef = useRef(brushSize);
  const colorRef = useRef(currentColor);
  toolRef.current = tool;
  brushSizeRef.current = brushSize;
  colorRef.current = currentColor;

  const strokeRef = useRef<{
    active: boolean;
    lastCell: number | null;
    snapshots: EditSnapshot[];
    startX: number;
    startY: number;
    longPressFired: boolean;
  }>({ active: false, lastCell: null, snapshots: [], startX: 0, startY: 0, longPressFired: false });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { width: W, height: H } = stateRef.current;
  const maxCellPx = Math.max(1, Math.floor(4096 / Math.max(W, H)));
  const cellPx = Math.max(1, Math.min(defaultCellPx ?? fitCellSize(W, H, 800, 560), maxCellPx));

  const syncFlags = useCallback((stats?: PatternStatsItem[], total?: number) => {
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
    setVersion((v) => v + 1);
    if (stats && total !== undefined && onStatsChange) onStatsChange(stats, total);
  }, [onStatsChange]);

  const commit = useCallback(
    (label: ToolId, snapshots: EditSnapshot[]): number => {
      if (snapshots.length === 0) return 0;
      historyRef.current.push({ label, snapshots });
      refreshStats(stateRef.current);
      syncFlags(stateRef.current.stats, stateRef.current.totalBeadCount);
      return snapshots.length;
    },
    [syncFlags],
  );

  const setColor = useCallback(
    (color: PaletteColor | null) => {
      setCurrentColorState(color);
      onColorChange?.(color);
    },
    [onColorChange],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssW = W * cellPx;
    const cssH = H * cellPx;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPattern(ctx, { width: W, height: H, cells: stateRef.current.cells }, {
      cellPx,
      showGrid: true,
      showSeams: true,
      showLabels: cellPx >= 12,
    });
    if (cursor) {
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 2;
      ctx.strokeRect(cursor.col * cellPx + 1, cursor.row * cellPx + 1, cellPx - 2, cellPx - 2);
    }
  }, [W, H, cellPx, cursor, version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    draw();
  }, [draw]);

  const cellAt = useCallback(
    (clientX: number, clientY: number): { row: number; col: number } | null => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return null;
      const rect = canvas.getBoundingClientRect();
      return pointToCell(
        clientX - rect.left + container.scrollLeft,
        clientY - rect.top + container.scrollTop,
        cellPx,
        0,
        0,
        W,
        H,
      );
    },
    [cellPx, W, H],
  );

  const paintAtCell = useCallback(
    (row: number, col: number): EditSnapshot[] => {
      const cells = stateRef.current.cells;
      const active = toolRef.current;
      if (active === 'brush') {
        const color = colorRef.current;
        if (!color) return [];
        return applyBrush(cells, W, H, row, col, brushSizeRef.current, color);
      }
      if (active === 'eraser') {
        return applyErase(cells, W, H, row, col, brushSizeRef.current);
      }
      return [];
    },
    [W, H],
  );

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const pickAtCell = useCallback(
    (row: number, col: number): void => {
      const cell = stateRef.current.cells[row * W + col];
      if (cell.transparent) {
        setColor(null);
      } else {
        setColor({ hex: cell.hex!, code: cell.code });
      }
    },
    [W, setColor],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    const active = toolRef.current;
    if (active === 'pick') {
      pickAtCell(cell.row, cell.col);
      return;
    }
    if (active === 'fill') {
      const color = colorRef.current;
      commit('fill', floodFill(stateRef.current.cells, W, H, cell.row, cell.col, color));
      return;
    }
    if (active !== 'brush' && active !== 'eraser') return;

    if (e.pointerType === 'touch') {
      // 触屏：按下不落笔，等待点按/长按判定
      strokeRef.current = {
        active: true,
        lastCell: cell.row * W + cell.col,
        snapshots: [],
        startX: e.clientX,
        startY: e.clientY,
        longPressFired: false,
      };
      clearLongPressTimer();
      longPressTimer.current = setTimeout(() => {
        strokeRef.current.longPressFired = true;
        strokeRef.current.active = false;
        pickAtCell(cell.row, cell.col);
      }, LONG_PRESS_MS);
    } else {
      strokeRef.current = {
        active: true,
        lastCell: cell.row * W + cell.col,
        snapshots: paintAtCell(cell.row, cell.col),
        startX: e.clientX,
        startY: e.clientY,
        longPressFired: false,
      };
    }
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // jsdom/部分浏览器无 setPointerCapture
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const cell = cellAt(e.clientX, e.clientY);
    if (strokeRef.current.active) {
      const stroke = strokeRef.current;
      const moved = Math.hypot(e.clientX - stroke.startX, e.clientY - stroke.startY) > MOVE_THRESHOLD_PX;
      if (moved) {
        clearLongPressTimer();
        stroke.longPressFired = false;
      }
      if (cell && (stroke.longPressFired || cell.row * W + cell.col !== stroke.lastCell)) {
        stroke.lastCell = cell.row * W + cell.col;
        if (!stroke.longPressFired) stroke.snapshots.push(...paintAtCell(cell.row, cell.col));
      }
      return;
    }
    setCursor(cell);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const stroke = strokeRef.current;
    if (stroke.active) {
      const wasLongPressPending = e.pointerType === 'touch' && longPressTimer.current !== null && !stroke.longPressFired;
      clearLongPressTimer();
      stroke.active = false;
      if (wasLongPressPending) {
        // 点按：在按下的格子落一笔
        const cell = cellAt(e.clientX, e.clientY);
        if (cell) commit(toolRef.current === 'brush' ? 'brush' : 'eraser', paintAtCell(cell.row, cell.col));
      } else if (!stroke.longPressFired) {
        commit(toolRef.current === 'brush' ? 'brush' : 'eraser', stroke.snapshots);
      }
      stroke.snapshots = [];
      stroke.lastCell = null;
    }
  };

  const undo = (): void => {
    if (!historyRef.current.undo(stateRef.current.cells)) return;
    refreshStats(stateRef.current);
    syncFlags(stateRef.current.stats, stateRef.current.totalBeadCount);
  };

  const redo = (): void => {
    if (!historyRef.current.redo(stateRef.current.cells)) return;
    refreshStats(stateRef.current);
    syncFlags(stateRef.current.stats, stateRef.current.totalBeadCount);
  };

  const onClear = (): void => {
    commit('clear', clearAll(stateRef.current.cells));
  };

  const onReplaceSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const from = replaceFrom.trim();
    if (!from) return;
    const target = replaceTo === 'transparent' ? null : (palette[Number(replaceTo)] ?? null);
    const count = commit('replace', replaceByCode(stateRef.current.cells, from, target));
    setReplaceMsg(count > 0 ? zhCN.editor.replaceCount(count) : zhCN.editor.replaceNone);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'b':
        setToolState('brush');
        break;
      case 'e':
        setToolState('eraser');
        break;
      case 'g':
        setToolState('fill');
        break;
      case 'i':
        setToolState('pick');
        break;
      case 'arrowup':
      case 'arrowdown':
      case 'arrowleft':
      case 'arrowright': {
        e.preventDefault();
        setCursor((prev) => {
          if (!prev) return { row: 0, col: 0 };
          const next = { ...prev };
          if (e.key === 'ArrowUp') next.row = Math.max(0, next.row - 1);
          if (e.key === 'ArrowDown') next.row = Math.min(H - 1, next.row + 1);
          if (e.key === 'ArrowLeft') next.col = Math.max(0, next.col - 1);
          if (e.key === 'ArrowRight') next.col = Math.min(W - 1, next.col + 1);
          return next;
        });
        break;
      }
      case 'enter': {
        if (cursor) commit(toolRef.current === 'brush' ? 'brush' : 'eraser', paintAtCell(cursor.row, cursor.col));
        break;
      }
      default:
        break;
    }
  };

  const t = zhCN.editor;

  return (
    <div className="flex flex-col gap-2">
      <EditorToolbar
        tool={tool}
        brushSize={brushSize}
        canUndo={canUndo}
        canRedo={canRedo}
        replaceCountMessage={replaceMsg}
        onToolChange={(next) => {
          setToolState(next);
          if (next === 'replace') setReplaceOpen((v) => !v);
        }}
        onBrushSizeChange={setBrushSizeState}
        onUndo={undo}
        onRedo={redo}
        onReplaceOpen={() => setReplaceOpen((v) => !v)}
        onClear={onClear}
      />

      {replaceOpen && (
        <form onSubmit={onReplaceSubmit} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 p-2 text-sm">
          <label htmlFor="editor-replace-from" className="text-gray-600">
            {t.replaceFrom}
          </label>
          <input
            id="editor-replace-from"
            value={replaceFrom}
            onChange={(e) => setReplaceFrom(e.target.value)}
            className="w-24 rounded border border-gray-300 px-2 py-1"
          />
          <label htmlFor="editor-replace-to" className="text-gray-600">
            {t.replaceTo}
          </label>
          <select
            id="editor-replace-to"
            value={replaceTo}
            onChange={(e) => setReplaceTo(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1"
          >
            {palette.map((p, i) => (
              <option key={p.hex} value={String(i)}>
                {p.code ?? p.hex}
              </option>
            ))}
            <option value="transparent">{t.excludeColor}</option>
          </select>
          <button type="submit" className="rounded border border-blue-500 bg-blue-50 px-2 py-1 text-blue-700">
            {t.replaceConfirm}
          </button>
        </form>
      )}

      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="overflow-auto rounded border border-gray-200 bg-gray-50 p-2 outline-none focus:ring-2 focus:ring-blue-300"
      >
        <canvas
          ref={canvasRef}
          aria-label={t.canvasAria}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ touchAction: 'none', maxWidth: '100%', cursor: tool === 'pick' ? 'copy' : 'crosshair' }}
        />
      </div>
      <p className="text-xs text-gray-400">
        {tool === 'pick' ? t.pickHint : t.cursorHint}
        {currentColor ? ` · ${currentColor.code ?? currentColor.hex}` : ` · ${t.noColor}`}
      </p>
    </div>
  );
}
