'use client';

/* eslint-disable react-hooks/refs -- pointer/camera state must stay synchronous between high-frequency events. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FingerLoupe, { type LoupeTarget } from '@/components/canvas/FingerLoupe';
import GridViewportControls from '@/components/canvas/GridViewportControls';
import useGridViewport from '@/components/canvas/useGridViewport';
import Icon from '@/components/ui/Icon';
import Notice from '@/components/ui/Notice';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { zhCN } from '@/messages/zh-CN';
import { contrastColor, prefersLightContrast, BOARD_SIZE } from '@/lib/render/layout';
import { readCanvasTheme } from '@/lib/render/canvasTheme';
import {
  panGridCamera,
  visibleGridRange,
  zoomGridCameraAt,
  type GridCamera,
} from '@/lib/render/gridViewport';
import {
  clearProgress,
  findNextStitchTarget,
  getBoardRect,
  isBoardRowDone,
  isStitchableCell,
  setBoardRowDone,
  summarizeProgress,
  toggleCell,
  type StitchProgress,
  type StitchTarget,
} from '@/lib/progress/stitchProgress';
import {
  canRedoStitchHistory,
  canUndoStitchHistory,
  commitStitchHistory,
  createStitchHistory,
  redoStitchHistory,
  undoStitchHistory,
  type StitchHistory,
} from '@/lib/progress/stitchHistory';
import type { Pattern } from '@/lib/types';

interface Props {
  pattern: Pattern;
  progress: StitchProgress;
  onChange: (next: StitchProgress) => void;
  boardSize?: number;
  layout?: 'desktop' | 'mobile';
  /** Deterministic component-test seam; production always measures the viewport. */
  testCellPx?: number;
}

type InteractionMode = 'pan' | 'mark';

interface FocusTarget {
  boardRow: number;
  boardCol: number;
  localRow: number;
  row: number;
  col: number;
}

type BoardRowTarget = FocusTarget;

type Gesture =
  | { kind: 'idle' }
  | {
      kind: 'candidate';
      pointerId: number;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      hit: { row: number; col: number } | null;
    }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number }
  | {
      kind: 'pinch';
      ids: [number, number];
      startDistance: number;
      startCenter: { x: number; y: number };
      startCamera: GridCamera;
    };

const TAP_MOVE_THRESHOLD_PX = 8;
const WORK_CELL_PX = 20;
const OVERVIEW_SIZE = 116;

function sameProgress(a: StitchProgress, b: StitchProgress): boolean {
  if (a.version !== b.version || a.width !== b.width || a.height !== b.height || a.done.length !== b.done.length) return false;
  for (let index = 0; index < a.done.length; index += 1) {
    if (a.done[index] !== b.done[index]) return false;
  }
  return true;
}

function focusFromTarget(target: StitchTarget | BoardRowTarget): FocusTarget {
  return {
    boardRow: target.boardRow,
    boardCol: target.boardCol,
    localRow: target.localRow,
    row: target.row,
    col: target.col,
  };
}

function constrainFocus(
  focus: FocusTarget,
  patternWidth: number,
  patternHeight: number,
  boardSize: number,
): FocusTarget {
  const row = Math.max(0, Math.min(patternHeight - 1, focus.row));
  const col = Math.max(0, Math.min(patternWidth - 1, focus.col));
  return {
    boardRow: Math.floor(row / boardSize),
    boardCol: Math.floor(col / boardSize),
    localRow: row % boardSize,
    row,
    col,
  };
}

function buildBoardRows(pattern: Pattern, boardSize: number): BoardRowTarget[] {
  const rows: BoardRowTarget[] = [];
  const boardRows = Math.ceil(pattern.height / boardSize);
  const boardCols = Math.ceil(pattern.width / boardSize);
  for (let boardRow = 0; boardRow < boardRows; boardRow += 1) {
    for (let boardCol = 0; boardCol < boardCols; boardCol += 1) {
      const rect = getBoardRect(pattern.width, pattern.height, boardRow, boardCol, boardSize);
      if (!rect) continue;
      for (let row = rect.rowStart; row < rect.rowEndExclusive; row += 1) {
        let firstCol: number | null = null;
        for (let col = rect.colStart; col < rect.colEndExclusive; col += 1) {
          if (isStitchableCell(pattern.cells[row * pattern.width + col])) {
            firstCol = col;
            break;
          }
        }
        if (firstCol !== null) {
          rows.push({ boardRow, boardCol, localRow: row - rect.rowStart, row, col: firstCol });
        }
      }
    }
  }
  return rows;
}

export default function StitchView({ pattern, progress, onChange, boardSize = BOARD_SIZE, layout = 'desktop', testCellPx }: Props) {
  const t = zhCN.stitch;
  const { confirm, confirmDialog } = useConfirm();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<Gesture>({ kind: 'idle' });
  const spacePressedRef = useRef(false);
  const workScaleAppliedRef = useRef(false);
  const boardRows = useMemo(() => buildBoardRows(pattern, boardSize), [boardSize, pattern]);
  const initialTarget = useMemo(
    () => findNextStitchTarget(progress, pattern.cells, boardSize) ?? boardRows[0] ?? {
      boardRow: 0,
      boardCol: 0,
      localRow: 0,
      row: 0,
      col: 0,
    },
    [boardRows, boardSize, pattern.cells, progress],
  );
  const [focus, setFocus] = useState<FocusTarget>(() => focusFromTarget(initialTarget));
  const resolvedFocus = useMemo(
    () => constrainFocus(focus, pattern.width, pattern.height, boardSize),
    [boardSize, focus, pattern.height, pattern.width],
  );
  const [mode, setMode] = useState<InteractionMode>(layout === 'mobile' ? 'pan' : 'mark');
  const [loupe, setLoupe] = useState<LoupeTarget | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(layout !== 'mobile');
  const [history, setHistory] = useState<StitchHistory>(() => createStitchHistory(progress));
  const historyRef = useRef(history);
  const activeProgress = history.current;
  const summary = useMemo(() => summarizeProgress(activeProgress, pattern.cells), [activeProgress, pattern.cells]);
  const viewport = useGridViewport({
    patternWidth: pattern.width,
    patternHeight: pattern.height,
    boardSize,
    initialBoard: { boardRow: initialTarget.boardRow, boardCol: initialTarget.boardCol },
    testCellPx,
  });
  const readCamera = viewport.readCamera;

  useEffect(() => { historyRef.current = history; }, [history]);

  useEffect(() => {
    if (sameProgress(progress, historyRef.current.current)) return;
    const next = createStitchHistory(progress);
    historyRef.current = next;
    setHistory(next);
  }, [progress]);

  useEffect(() => {
    if (layout !== 'mobile' || workScaleAppliedRef.current || viewport.size.width <= 1) return;
    workScaleAppliedRef.current = true;
    if (viewport.camera.cellPx < WORK_CELL_PX) {
      viewport.zoomAt(WORK_CELL_PX, viewport.size.width / 2, viewport.size.height / 2);
      viewport.centerCell(resolvedFocus.row, resolvedFocus.col);
    }
  }, [layout, resolvedFocus.col, resolvedFocus.row, viewport]);

  const commitProgress = useCallback((next: StitchProgress): void => {
    const current = historyRef.current;
    if (next === current.current || sameProgress(next, current.current)) return;
    const nextHistory = commitStitchHistory(current, next);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    onChange(nextHistory.current);
  }, [onChange]);

  const selectFocus = useCallback((row: number, col: number, center = false): void => {
    setFocus({
      boardRow: Math.floor(row / boardSize),
      boardCol: Math.floor(col / boardSize),
      localRow: row % boardSize,
      row,
      col,
    });
    if (center) viewport.centerCell(row, col);
  }, [boardSize, viewport]);

  const focusBoardRow = useCallback((target: BoardRowTarget): void => {
    setFocus(focusFromTarget(target));
    viewport.centerCell(target.row, target.col);
  }, [viewport]);

  const moveBoardRow = useCallback((delta: number): void => {
    if (boardRows.length === 0) return;
    let index = boardRows.findIndex((entry) => (
      entry.boardRow === resolvedFocus.boardRow
      && entry.boardCol === resolvedFocus.boardCol
      && entry.localRow === resolvedFocus.localRow
    ));
    if (index < 0) index = 0;
    focusBoardRow(boardRows[Math.max(0, Math.min(boardRows.length - 1, index + delta))]);
  }, [boardRows, focusBoardRow, resolvedFocus]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(1, Math.floor(viewport.size.width));
    const height = Math.max(1, Math.floor(viewport.size.height));
    const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    const theme = readCanvasTheme(canvas);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = theme.surface;
    context.fillRect(0, 0, width, height);

    const { cellPx, offsetX, offsetY } = viewport.camera;
    const range = visibleGridRange(viewport.camera, pattern.width, pattern.height, viewport.size);
    const activeRect = getBoardRect(pattern.width, pattern.height, resolvedFocus.boardRow, resolvedFocus.boardCol, boardSize);
    if (activeRect) {
      context.fillStyle = theme.activeRow;
      context.fillRect(offsetX + activeRect.colStart * cellPx, offsetY + resolvedFocus.row * cellPx, activeRect.width * cellPx, cellPx);
    }
    context.font = `${Math.max(8, Math.min(12, cellPx * 0.38))}px ui-monospace, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let row = range.rowStart; row < range.rowEnd; row += 1) {
      for (let col = range.colStart; col < range.colEnd; col += 1) {
        const index = row * pattern.width + col;
        const cell = pattern.cells[index];
        if (!isStitchableCell(cell)) continue;
        const x = offsetX + col * cellPx;
        const y = offsetY + row * cellPx;
        const done = activeProgress.done[index] === 1;
        context.globalAlpha = done ? 0.25 : 1;
        context.fillStyle = cell.hex!;
        context.fillRect(x, y, cellPx, cellPx);
        context.globalAlpha = 1;
        if (cellPx >= 4) {
          context.strokeStyle = theme.grid;
          context.lineWidth = 1;
          context.strokeRect(x + 0.5, y + 0.5, Math.max(0, cellPx - 1), Math.max(0, cellPx - 1));
        }
        if (done && cellPx >= 10) {
          context.strokeStyle = prefersLightContrast(cell.hex!) ? theme.doneLight : theme.doneDark;
          context.lineWidth = Math.max(1.5, cellPx * 0.11);
          context.beginPath();
          context.moveTo(x + cellPx * 0.24, y + cellPx * 0.52);
          context.lineTo(x + cellPx * 0.43, y + cellPx * 0.7);
          context.lineTo(x + cellPx * 0.77, y + cellPx * 0.3);
          context.stroke();
        } else if (cellPx >= 18 && cell.code) {
          context.fillStyle = contrastColor(cell.hex!);
          context.fillText(cell.code, x + cellPx / 2, y + cellPx / 2);
        }
      }
    }
    context.strokeStyle = theme.seam;
    context.lineWidth = 1.5;
    for (let col = boardSize; col < pattern.width; col += boardSize) {
      const x = offsetX + col * cellPx;
      if (x < -2 || x > width + 2) continue;
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    for (let row = boardSize; row < pattern.height; row += boardSize) {
      const y = offsetY + row * cellPx;
      if (y < -2 || y > height + 2) continue;
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    if (activeRect) {
      context.strokeStyle = theme.lilac;
      context.lineWidth = 2;
      context.strokeRect(offsetX + activeRect.colStart * cellPx, offsetY + activeRect.rowStart * cellPx, activeRect.width * cellPx, activeRect.height * cellPx);
      context.strokeStyle = theme.primary;
      context.lineWidth = 2.5;
      context.strokeRect(offsetX + activeRect.colStart * cellPx, offsetY + resolvedFocus.row * cellPx, activeRect.width * cellPx, cellPx);
    }
  }, [activeProgress, boardSize, pattern, resolvedFocus, viewport.camera, viewport.size]);

  useEffect(() => {
    const canvas = overviewRef.current;
    if (!canvas) return;
    const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
    canvas.width = OVERVIEW_SIZE * dpr;
    canvas.height = OVERVIEW_SIZE * dpr;
    const context = canvas.getContext('2d');
    if (!context) return;
    const theme = readCanvasTheme(canvas);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, OVERVIEW_SIZE, OVERVIEW_SIZE);
    context.fillStyle = theme.surface;
    context.fillRect(0, 0, OVERVIEW_SIZE, OVERVIEW_SIZE);
    const scale = Math.min((OVERVIEW_SIZE - 8) / pattern.width, (OVERVIEW_SIZE - 8) / pattern.height);
    const offsetX = (OVERVIEW_SIZE - pattern.width * scale) / 2;
    const offsetY = (OVERVIEW_SIZE - pattern.height * scale) / 2;
    for (let row = 0; row < pattern.height; row += 1) {
      for (let col = 0; col < pattern.width; col += 1) {
        const index = row * pattern.width + col;
        const cell = pattern.cells[index];
        if (!isStitchableCell(cell)) continue;
        context.globalAlpha = activeProgress.done[index] === 1 ? 0.24 : 0.92;
        context.fillStyle = cell.hex!;
        context.fillRect(offsetX + col * scale, offsetY + row * scale, Math.max(1, scale), Math.max(1, scale));
      }
    }
    context.globalAlpha = 1;
    const rect = getBoardRect(pattern.width, pattern.height, resolvedFocus.boardRow, resolvedFocus.boardCol, boardSize);
    if (rect) {
      context.strokeStyle = theme.primary;
      context.lineWidth = 2;
      context.strokeRect(offsetX + rect.colStart * scale, offsetY + rect.rowStart * scale, rect.width * scale, rect.height * scale);
    }
    const worldLeft = Math.max(0, -viewport.camera.offsetX / viewport.camera.cellPx);
    const worldTop = Math.max(0, -viewport.camera.offsetY / viewport.camera.cellPx);
    const worldRight = Math.min(pattern.width, (viewport.size.width - viewport.camera.offsetX) / viewport.camera.cellPx);
    const worldBottom = Math.min(pattern.height, (viewport.size.height - viewport.camera.offsetY) / viewport.camera.cellPx);
    if (worldRight > worldLeft && worldBottom > worldTop) {
      context.strokeStyle = theme.viewportFrame;
      context.lineWidth = 1.5;
      context.strokeRect(
        offsetX + worldLeft * scale,
        offsetY + worldTop * scale,
        (worldRight - worldLeft) * scale,
        (worldBottom - worldTop) * scale,
      );
    }
  }, [activeProgress, boardSize, pattern, resolvedFocus.boardCol, resolvedFocus.boardRow, viewport.camera, viewport.size]);

  const startPinch = useCallback((): void => {
    const entries = [...pointersRef.current.entries()];
    if (entries.length < 2) return;
    const [[firstId, first], [secondId, second]] = entries;
    setLoupe(null);
    gestureRef.current = {
      kind: 'pinch',
      ids: [firstId, secondId],
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      startCenter: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      startCamera: readCamera(),
    };
  }, [readCamera]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = viewport.localPoint(event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* optional */ }
    if (pointersRef.current.size >= 2) { startPinch(); return; }
    const rawHit = viewport.cellAtClientPoint(event.clientX, event.clientY);
    const hit = rawHit && isStitchableCell(pattern.cells[rawHit.row * pattern.width + rawHit.col]) ? rawHit : null;
    if (hit) selectFocus(hit.row, hit.col);
    const wantsPan = mode === 'pan' || event.button === 1 || spacePressedRef.current;
    gestureRef.current = wantsPan
      ? { kind: 'pan', pointerId: event.pointerId, lastX: point.x, lastY: point.y }
      : { kind: 'candidate', pointerId: event.pointerId, startX: point.x, startY: point.y, lastX: point.x, lastY: point.y, hit };
    if (!wantsPan && hit && (event.pointerType === 'touch' || event.pointerType === 'pen')) setLoupe({ ...hit, x: point.x, y: point.y });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = viewport.localPoint(event.clientX, event.clientY);
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size >= 2) {
      if (gestureRef.current.kind !== 'pinch') startPinch();
      const gesture = gestureRef.current;
      if (gesture.kind !== 'pinch') return;
      const first = pointersRef.current.get(gesture.ids[0]);
      const second = pointersRef.current.get(gesture.ids[1]);
      if (!first || !second) return;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const zoomed = zoomGridCameraAt(gesture.startCamera, gesture.startCamera.cellPx * (distance / gesture.startDistance), gesture.startCenter.x, gesture.startCenter.y);
      viewport.applyCamera(panGridCamera(zoomed, center.x - gesture.startCenter.x, center.y - gesture.startCenter.y));
      return;
    }
    const gesture = gestureRef.current;
    if (gesture.kind === 'pan' && gesture.pointerId === event.pointerId) {
      viewport.panBy(point.x - gesture.lastX, point.y - gesture.lastY);
      gesture.lastX = point.x;
      gesture.lastY = point.y;
      return;
    }
    if (gesture.kind !== 'candidate' || gesture.pointerId !== event.pointerId) return;
    if (Math.hypot(point.x - gesture.startX, point.y - gesture.startY) > TAP_MOVE_THRESHOLD_PX) {
      setLoupe(null);
      viewport.panBy(point.x - gesture.lastX, point.y - gesture.lastY);
      gestureRef.current = { kind: 'pan', pointerId: event.pointerId, lastX: point.x, lastY: point.y };
      return;
    }
    const hit = viewport.cellAtClientPoint(event.clientX, event.clientY);
    if (hit && (event.pointerType === 'touch' || event.pointerType === 'pen')) setLoupe({ ...hit, x: point.x, y: point.y });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const gesture = gestureRef.current;
    const point = viewport.localPoint(event.clientX, event.clientY);
    pointersRef.current.delete(event.pointerId);
    setLoupe(null);
    if (gesture.kind === 'candidate' && gesture.pointerId === event.pointerId) {
      const hit = viewport.cellAtClientPoint(event.clientX, event.clientY);
      const stayedStill = Math.hypot(point.x - gesture.startX, point.y - gesture.startY) <= TAP_MOVE_THRESHOLD_PX;
      if (mode === 'mark' && stayedStill && hit && gesture.hit && hit.row === gesture.hit.row && hit.col === gesture.hit.col && isStitchableCell(pattern.cells[hit.row * pattern.width + hit.col])) {
        commitProgress(toggleCell(historyRef.current.current, hit.row, hit.col));
        selectFocus(hit.row, hit.col);
      }
    }
    gestureRef.current = { kind: 'idle' };
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    pointersRef.current.delete(event.pointerId);
    setLoupe(null);
    gestureRef.current = { kind: 'idle' };
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const point = viewport.localPoint(event.clientX, event.clientY);
      viewport.zoomAt(readCamera().cellPx * (event.deltaY < 0 ? 1.14 : 0.88), point.x, point.y);
    } else {
      viewport.panBy(-event.deltaX, -event.deltaY);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === ' ') {
      spacePressedRef.current = true;
      if (event.target === event.currentTarget) event.preventDefault();
      return;
    }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveBoardRow(-1); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); moveBoardRow(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); selectFocus(resolvedFocus.row, Math.max(0, resolvedFocus.col - 1), true); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); selectFocus(resolvedFocus.row, Math.min(pattern.width - 1, resolvedFocus.col + 1), true); }
    else if (event.key === 'Enter' && mode === 'mark') {
      event.preventDefault();
      if (isStitchableCell(pattern.cells[resolvedFocus.row * pattern.width + resolvedFocus.col])) commitProgress(toggleCell(historyRef.current.current, resolvedFocus.row, resolvedFocus.col));
    }
  };

  const onOverviewClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (OVERVIEW_SIZE / Math.max(1, rect.width));
    const y = (event.clientY - rect.top) * (OVERVIEW_SIZE / Math.max(1, rect.height));
    const scale = Math.min((OVERVIEW_SIZE - 8) / pattern.width, (OVERVIEW_SIZE - 8) / pattern.height);
    const offsetX = (OVERVIEW_SIZE - pattern.width * scale) / 2;
    const offsetY = (OVERVIEW_SIZE - pattern.height * scale) / 2;
    const col = Math.floor((x - offsetX) / scale);
    const row = Math.floor((y - offsetY) / scale);
    if (row < 0 || col < 0 || row >= pattern.height || col >= pattern.width) return;
    const boardRow = Math.floor(row / boardSize);
    const boardCol = Math.floor(col / boardSize);
    const target = boardRows.find((entry) => entry.boardRow === boardRow && entry.boardCol === boardCol);
    if (!target) return;
    setFocus(focusFromTarget(target));
    viewport.fitBoard(boardRow, boardCol);
    if (layout === 'mobile') setOverviewOpen(false);
  };

  const markRow = (value: boolean): void => {
    const next = setBoardRowDone(
      historyRef.current.current,
      pattern.cells,
      resolvedFocus.boardRow,
      resolvedFocus.boardCol,
      resolvedFocus.localRow,
      value,
      new Date(),
      boardSize,
    );
    commitProgress(next);
    if (value) moveBoardRow(1);
  };

  const undo = (): void => {
    const next = undoStitchHistory(historyRef.current);
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
    onChange(next.current);
  };

  const redo = (): void => {
    const next = redoStitchHistory(historyRef.current);
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
    onChange(next.current);
  };

  const reset = async (): Promise<void> => {
    const ok = await confirm({ title: t.resetTitle, message: t.resetMessage, confirmLabel: t.resetAction, danger: true });
    if (ok) commitProgress(clearProgress(historyRef.current.current));
  };

  const rowDone = isBoardRowDone(activeProgress, pattern.cells, resolvedFocus.boardRow, resolvedFocus.boardCol, resolvedFocus.localRow, boardSize);
  const boardCols = Math.max(1, Math.ceil(pattern.width / boardSize));
  const boardCount = boardCols * Math.max(1, Math.ceil(pattern.height / boardSize));
  const boardNumber = resolvedFocus.boardRow * boardCols + resolvedFocus.boardCol + 1;
  const nextPending = findNextStitchTarget(activeProgress, pattern.cells, boardSize);

  return (
    <section aria-label={t.title} className={`stitch-studio is-${layout}`}>
      <header className="stitch-status-bar">
        <div><span>{t.boardLabel(boardNumber, boardCount)}</span><strong>{t.localRowLabel(resolvedFocus.localRow + 1)}</strong></div>
        <span className="sr-only">{t.rowLabel(resolvedFocus.row + 1, pattern.height)}</span>
        <p role="status">{t.progress(summary.doneCount, summary.total, summary.percent)}</p>
        <progress value={summary.percent} max={100} aria-label={t.progressAria} />
      </header>

      <div className="stitch-viewport-layout">
        <div ref={viewport.viewportRef} tabIndex={0} onKeyDown={onKeyDown} onKeyUp={(event) => { if (event.key === ' ') spacePressedRef.current = false; }} onBlur={() => { spacePressedRef.current = false; }} className="grid-canvas-viewport stitch-canvas-viewport" aria-label={t.canvasRegion}>
          <canvas ref={canvasRef} role="img" aria-label={t.canvasAria(pattern.width, pattern.height, summary.percent)} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onWheel={onWheel} style={{ touchAction: 'none', cursor: mode === 'pan' ? 'grab' : 'crosshair' }} />
          <span className="grid-coordinate-chip is-row">{t.rowCoordinate(resolvedFocus.row + 1)}</span>
          <span className="grid-coordinate-chip is-col">{t.colCoordinate(resolvedFocus.col + 1)}</span>
          <GridViewportControls cellPx={viewport.camera.cellPx} onZoomOut={() => viewport.zoomAt(readCamera().cellPx * 0.8, viewport.size.width / 2, viewport.size.height / 2)} onZoomIn={() => viewport.zoomAt(readCamera().cellPx * 1.25, viewport.size.width / 2, viewport.size.height / 2)} onFitBoard={() => viewport.fitBoard(resolvedFocus.boardRow, resolvedFocus.boardCol)} onFitPattern={viewport.fitPattern} />
          <FingerLoupe pattern={pattern} target={loupe} viewportWidth={viewport.size.width} viewportHeight={viewport.size.height} done={activeProgress.done} />
        </div>

        <aside className={`stitch-overview${overviewOpen ? ' is-open' : ''}`} aria-label={t.overviewTitle}>
          <header><strong>{t.overviewTitle}</strong>{layout === 'mobile' && <button type="button" onClick={() => setOverviewOpen(false)} aria-label={zhCN.common.close}>×</button>}</header>
          <canvas ref={overviewRef} onClick={onOverviewClick} width={OVERVIEW_SIZE} height={OVERVIEW_SIZE} role="img" aria-label={t.overviewHint} />
          <p>{t.overviewHint}</p>
          <button type="button" className="btn-outline btn-xs" onClick={() => { if (!nextPending) return; setFocus(focusFromTarget(nextPending)); viewport.fitBoard(nextPending.boardRow, nextPending.boardCol); }} disabled={!nextPending}>{t.jumpPending}</button>
          <button type="button" className="btn-danger-outline btn-xs" onClick={() => void reset()}>{t.reset}</button>
        </aside>
      </div>

      <nav className="stitch-action-dock" aria-label={t.actionsLabel}>
        <span className="stitch-mode-toggle" aria-label={t.modeLabel}>
          <button type="button" aria-pressed={mode === 'pan'} onClick={() => { setMode('pan'); setLoupe(null); }}><Icon name="hand" size={18} /><span>{t.panMode}</span></button>
          <button type="button" aria-pressed={mode === 'mark'} onClick={() => setMode('mark')}><Icon name="mark" size={18} /><span>{t.markMode}</span></button>
        </span>
        <button type="button" onClick={undo} disabled={!canUndoStitchHistory(history)} aria-label={t.undo}><Icon name="undo" size={18} /><span>{t.undo}</span></button>
        <button type="button" onClick={redo} disabled={!canRedoStitchHistory(history)} aria-label={t.redo} className="stitch-redo-action"><Icon name="redo" size={18} /><span>{t.redo}</span></button>
        <button type="button" onClick={() => moveBoardRow(-1)} aria-label={t.prevRow}><span aria-hidden="true">↑</span><span>{t.prevRow}</span></button>
        <button type="button" onClick={() => markRow(!rowDone)} className="is-primary"><Icon name="mark" size={18} /><span>{rowDone ? t.markRowUndone : t.markRowDone}</span></button>
        <button type="button" onClick={() => moveBoardRow(1)} aria-label={t.nextRow}><span aria-hidden="true">↓</span><span>{t.nextRow}</span></button>
        <button type="button" onClick={() => setOverviewOpen((value) => !value)} className="stitch-overview-action"><Icon name="grid" size={18} /><span>{t.overviewAction}</span></button>
      </nav>

      {summary.total > 0 && summary.doneCount === summary.total && <Notice kind="success">{t.finished}</Notice>}
      <p className="stitch-help-text">{mode === 'pan' ? t.panHint : t.markHint}</p>
      {confirmDialog}
    </section>
  );
}
