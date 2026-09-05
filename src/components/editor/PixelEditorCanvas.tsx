'use client';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';

/* eslint-disable react-hooks/refs -- pointer/camera state must stay synchronous during gestures. */

/**
 * 有界像素编辑工作台。
 * 相机手势与编辑事务严格分层：平移、缩放、取消与第二指介入都不会提交图纸；
 * 一次按下到抬起只形成一条可撤销笔迹。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FingerLoupe, { type LoupeTarget } from '@/components/canvas/FingerLoupe';
import GridViewportControls from '@/components/canvas/GridViewportControls';
import useGridViewport from '@/components/canvas/useGridViewport';
import Modal from '@/components/ui/Modal';
import EditorToolbar from './EditorToolbar';
import { zhCN } from '@/messages/zh-CN';
import type { PaletteColor, Pattern, PatternStatsItem } from '@/lib/types';
import { BOARD_SIZE, contrastColor } from '@/lib/render/layout';
import { readCanvasTheme } from '@/lib/render/canvasTheme';
import {
  panGridCamera,
  visibleGridRange,
  zoomGridCameraAt,
  type GridCamera,
} from '@/lib/render/gridViewport';
import { EditHistory } from '@/lib/editor/history';
import {
  applyBrush,
  applyErase,
  applyTransform,
  clearAll,
  floodFill,
  replaceByCode,
  rasterizeGridLine,
  rollbackSnapshots,
  type BrushSize,
  type EditSnapshot,
  type ToolId,
  type TransformOp,
} from '@/lib/editor/ops';
import { createEditorState, refreshStats } from '@/lib/editor/state';

const MOVE_THRESHOLD_PX = 8;
const MIN_EDIT_CELL_PX = 20;
const MAX_DPR = 2;

interface Props {
  pattern: Pattern;
  palette: PaletteColor[];
  boardSize?: number;
  autoFocus?: boolean;
  /** Deterministic component-test seam. Production always measures its viewport. */
  defaultCellPx?: number;
  layout?: 'desktop' | 'mobile';
  onStatsChange?: (stats: PatternStatsItem[], total: number) => void;
  onColorChange?: (color: PaletteColor | null) => void;
  onPatternChange?: (pattern: Pattern) => void;
}

type InteractionMode = 'pan' | 'edit';
export type MobileStrokeMode = 'precision' | 'continuous';
type Point = { x: number; y: number };
type Cell = { row: number; col: number };
type Gesture =
  | { kind: 'idle' }
  | { kind: 'stroke'; pointerId: number; lastCell: number; snapshots: EditSnapshot[] }
  | {
      kind: 'candidate';
      pointerId: number;
      startX: number;
      startY: number;
      hit: Cell | null;
      startHit: Cell;
      cancelled: boolean;
      allowDrag: boolean;
      tool: 'brush' | 'eraser' | 'fill' | 'pick';
    }
  | {
      kind: 'pan';
      pointerId: number;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      hit: Cell | null;
    }
  | {
      kind: 'pinch';
      ids: [number, number];
      startDistance: number;
      startCenter: Point;
      startCamera: GridCamera;
    };

function distance(a: Point, b: Point): number {
  return Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function sameGridCell(a: Cell | null, b: Cell | null): boolean {
  return a !== null && b !== null && a.row === b.row && a.col === b.col;
}

export default function PixelEditorCanvas({
  pattern,
  palette,
  boardSize = BOARD_SIZE,
  autoFocus = false,
  defaultCellPx,
  layout = 'desktop',
  onStatsChange,
  onColorChange,
  onPatternChange,
}: Props) {
  const t = zhCN.editor;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(createEditorState(pattern));
  const historyRef = useRef(new EditHistory());
  const onPatternChangeRef = useRef(onPatternChange);
  const lastEmittedRef = useRef<Pattern | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<Gesture>({ kind: 'idle' });
  const spacePressedRef = useRef(false);
  const scaleNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const availablePalette = useMemo(
    () => palette.filter((color) => color.code !== null && color.code.trim().length > 0),
    [palette],
  );

  const [tool, setToolState] = useState<ToolId>('brush');
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(layout === 'mobile' ? 'pan' : 'edit');
  const [mobileStrokeMode, setMobileStrokeMode] = useState<MobileStrokeMode>('precision');
  const [brushSize, setBrushSizeState] = useState<BrushSize>(1);
  const [currentColor, setCurrentColorState] = useState<PaletteColor | null>(availablePalette[0] ?? null);
  const [cursor, setCursor] = useState<Cell | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [version, setVersion] = useState(0);
  const [loupe, setLoupe] = useState<LoupeTarget | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scaleNotice, setScaleNotice] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceFrom, setReplaceFrom] = useState('');
  const [replaceTo, setReplaceTo] = useState('0');
  const [replaceMsg, setReplaceMsg] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [editNotice, setEditNotice] = useState<string | null>(null);

  const toolRef = useRef(tool);
  const brushSizeRef = useRef(brushSize);
  const colorRef = useRef(currentColor);
  const interactionModeRef = useRef(interactionMode);
  const mobileStrokeModeRef = useRef(mobileStrokeMode);
  const { width: W, height: H } = stateRef.current;
  const viewport = useGridViewport({ patternWidth: W, patternHeight: H, boardSize, testCellPx: defaultCellPx });
  const readCamera = viewport.readCamera;

  useEffect(() => {
    onPatternChangeRef.current = onPatternChange;
    toolRef.current = tool;
    brushSizeRef.current = brushSize;
    colorRef.current = currentColor;
    interactionModeRef.current = interactionMode;
    mobileStrokeModeRef.current = mobileStrokeMode;
  }, [brushSize, currentColor, interactionMode, mobileStrokeMode, onPatternChange, tool]);

  useEffect(() => {
    if (autoFocus) viewport.viewportRef.current?.focus();
  }, [autoFocus, viewport.viewportRef]);

  const syncFlags = useCallback((stats?: PatternStatsItem[], total?: number) => {
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
    setVersion((value) => value + 1);
    if (stats && total !== undefined) onStatsChange?.(stats, total);
    const { width, height, cells } = stateRef.current;
    const emitted: Pattern = { width, height, cells: cells.map((cell) => ({ ...cell })) };
    lastEmittedRef.current = emitted;
    onPatternChangeRef.current?.(emitted);
  }, [onStatsChange]);

  useEffect(() => {
    if (pattern === lastEmittedRef.current) return;
    // 父组件传入的新图纸会建立新的编辑事务边界。必须先丢弃旧手势再替换状态，
    // 否则迟到的回滚会把上一张图纸的格子写进新图纸。
    gestureRef.current = { kind: 'idle' };
    pointersRef.current.clear();
    setLoupe(null);
    stateRef.current = createEditorState(pattern);
    historyRef.current = new EditHistory();
    setCanUndo(false);
    setCanRedo(false);
    setCursor(null);
    const color = availablePalette[0] ?? null;
    setCurrentColorState(color);
    onColorChange?.(color);
    setVersion((value) => value + 1);
  }, [availablePalette, onColorChange, pattern]);

  const commit = useCallback((label: ToolId, snapshots: EditSnapshot[]): number => {
    if (snapshots.length === 0) return 0;
    historyRef.current.push({ label, snapshots });
    refreshStats(stateRef.current);
    syncFlags(stateRef.current.stats, stateRef.current.totalBeadCount);
    return snapshots.length;
  }, [syncFlags]);

  const setColor = useCallback((color: PaletteColor | null) => {
    setEditNotice(null);
    setCurrentColorState(color);
    onColorChange?.(color);
  }, [onColorChange]);

  const paintAtCell = useCallback((row: number, col: number): EditSnapshot[] => {
    const active = toolRef.current;
    if (active === 'brush') {
      const color = colorRef.current;
      if (!color) return [];
      return applyBrush(stateRef.current.cells, stateRef.current.width, stateRef.current.height, row, col, brushSizeRef.current, color);
    }
    if (active === 'eraser') {
      return applyErase(stateRef.current.cells, stateRef.current.width, stateRef.current.height, row, col, brushSizeRef.current);
    }
    return [];
  }, []);

  const pickAtCell = useCallback((row: number, col: number): void => {
    const width = stateRef.current.width;
    const cell = stateRef.current.cells[row * width + col];
    if (!cell || cell.transparent || !cell.hex || !cell.code) {
      setEditNotice(t.pickUnavailable);
      return;
    }
    setColor({ hex: cell.hex, code: cell.code });
  }, [setColor, t.pickUnavailable]);

  const cursorCellLabel = useCallback((row: number, col: number): string => {
    const cell = stateRef.current.cells[row * stateRef.current.width + col];
    if (!cell) return '—';
    return cell.transparent ? t.emptyCell : (cell.code ?? cell.hex ?? '—');
  }, [t.emptyCell]);

  const cancelGesture = useCallback((redraw = true): boolean => {
    const gesture = gestureRef.current;
    const cancelledDataGesture = gesture.kind === 'stroke' || gesture.kind === 'candidate';
    if (gesture.kind === 'stroke') rollbackSnapshots(stateRef.current.cells, gesture.snapshots);
    gestureRef.current = { kind: 'idle' };
    pointersRef.current.clear();
    setLoupe(null);
    if (gesture.kind === 'stroke' && redraw) setVersion((value) => value + 1);
    return cancelledDataGesture;
  }, []);

  useEffect(() => () => {
    if (scaleNoticeTimerRef.current) clearTimeout(scaleNoticeTimerRef.current);
  }, []);

  const showEditScaleNotice = useCallback((): void => {
    setScaleNotice(true);
    if (scaleNoticeTimerRef.current) clearTimeout(scaleNoticeTimerRef.current);
    scaleNoticeTimerRef.current = setTimeout(() => setScaleNotice(false), 2200);
  }, []);

  const enterPanMode = useCallback((): void => {
    cancelGesture();
    interactionModeRef.current = 'pan';
    setInteractionMode('pan');
    setLoupe(null);
  }, [cancelGesture]);

  const enterEditMode = useCallback((nextTool?: ToolId): void => {
    cancelGesture();
    const selected = nextTool ?? toolRef.current;
    if (nextTool) {
      toolRef.current = nextTool;
      setToolState(nextTool);
    }
    interactionModeRef.current = 'edit';
    setInteractionMode('edit');
    if (layout === 'mobile' && viewport.camera.cellPx < MIN_EDIT_CELL_PX) {
      viewport.zoomAt(MIN_EDIT_CELL_PX, viewport.size.width / 2, viewport.size.height / 2);
      const target = cursor ?? { row: Math.floor(stateRef.current.height / 2), col: Math.floor(stateRef.current.width / 2) };
      viewport.centerCell(target.row, target.col);
      showEditScaleNotice();
    }
    if (selected === 'replace') setReplaceOpen((open) => !open);
  }, [cancelGesture, cursor, layout, showEditScaleNotice, viewport]);

  const changeMobileStrokeMode = useCallback((next: MobileStrokeMode): void => {
    cancelGesture();
    mobileStrokeModeRef.current = next;
    setMobileStrokeMode(next);
  }, [cancelGesture]);

  const draw = useCallback((): void => {
    void version;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(1, Math.floor(viewport.size.width));
    const height = Math.max(1, Math.floor(viewport.size.height));
    const dpr = typeof window === 'undefined' ? 1 : Math.min(MAX_DPR, window.devicePixelRatio || 1);
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
    const state = stateRef.current;
    const range = visibleGridRange(viewport.camera, state.width, state.height, viewport.size);
    context.font = `${Math.max(8, Math.min(12, cellPx * 0.38))}px ui-monospace, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let row = range.rowStart; row < range.rowEnd; row += 1) {
      for (let col = range.colStart; col < range.colEnd; col += 1) {
        const cell = state.cells[row * state.width + col];
        const x = offsetX + col * cellPx;
        const y = offsetY + row * cellPx;
        context.fillStyle = cell?.transparent ? theme.empty : (cell?.hex ?? theme.unavailable);
        context.fillRect(x, y, cellPx, cellPx);
        if (cell?.external) {
          context.strokeStyle = theme.external;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(x + 2, y + 2);
          context.lineTo(x + cellPx - 2, y + cellPx - 2);
          context.stroke();
        }
        context.strokeStyle = theme.grid;
        context.lineWidth = 1;
        context.strokeRect(x, y, cellPx, cellPx);
        if (cellPx >= 12 && cell && !cell.transparent && cell.code) {
          context.fillStyle = contrastColor(cell.hex!);
          context.fillText(cell.code, x + cellPx / 2, y + cellPx / 2, Math.max(1, cellPx - 2));
        }
      }
    }

    context.strokeStyle = theme.seam;
    context.lineWidth = Math.max(1.5, Math.min(3, cellPx / 5));
    for (let seam = boardSize; seam < state.width; seam += boardSize) {
      const x = offsetX + seam * cellPx;
      if (x >= -4 && x <= width + 4) {
        context.beginPath();
        context.moveTo(x, Math.max(0, offsetY));
        context.lineTo(x, Math.min(height, offsetY + state.height * cellPx));
        context.stroke();
      }
    }
    for (let seam = boardSize; seam < state.height; seam += boardSize) {
      const y = offsetY + seam * cellPx;
      if (y >= -4 && y <= height + 4) {
        context.beginPath();
        context.moveTo(Math.max(0, offsetX), y);
        context.lineTo(Math.min(width, offsetX + state.width * cellPx), y);
        context.stroke();
      }
    }

    if (cursor && cursor.row < state.height && cursor.col < state.width) {
      const x = offsetX + cursor.col * cellPx;
      const y = offsetY + cursor.row * cellPx;
      context.lineWidth = Math.max(3, cellPx / 4);
      context.strokeStyle = theme.focusOuter;
      context.strokeRect(x + 1, y + 1, Math.max(1, cellPx - 2), Math.max(1, cellPx - 2));
      context.lineWidth = Math.max(2, cellPx / 8);
      context.strokeStyle = theme.primary;
      context.strokeRect(x + 1, y + 1, Math.max(1, cellPx - 2), Math.max(1, cellPx - 2));
    }
  }, [boardSize, cursor, version, viewport.camera, viewport.size]);

  useEffect(() => { draw(); }, [draw]);

  const updateLoupe = useCallback((event: React.PointerEvent<HTMLCanvasElement>, cell: Cell | null): void => {
    if (!cell || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) {
      setLoupe(null);
      return;
    }
    const point = viewport.localPoint(event.clientX, event.clientY);
    setLoupe({ ...cell, x: point.x, y: point.y });
  }, [viewport]);

  const startPinch = useCallback((): void => {
    const entries = [...pointersRef.current.entries()];
    if (entries.length < 2) return;
    const active = gestureRef.current;
    if (active.kind === 'stroke') {
      rollbackSnapshots(stateRef.current.cells, active.snapshots);
      setVersion((value) => value + 1);
    }
    const [[firstId, first], [secondId, second]] = entries;
    gestureRef.current = {
      kind: 'pinch',
      ids: [firstId, secondId],
      startDistance: distance(first, second),
      startCenter: midpoint(first, second),
      startCamera: readCamera(),
    };
    setLoupe(null);
  }, [readCamera]);

  const capturePointer = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and older browsers may not implement pointer capture.
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    viewport.viewportRef.current?.focus();
    const point = viewport.localPoint(event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);
    capturePointer(event);
    if (pointersRef.current.size >= 2) {
      startPinch();
      return;
    }

    const hit = viewport.cellAtClientPoint(event.clientX, event.clientY);
    const navigation = interactionModeRef.current === 'pan' || spacePressedRef.current || event.button === 1;
    if (navigation) {
      gestureRef.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        hit,
      };
      setLoupe(null);
      return;
    }
    if (!hit) return;
    setCursor(hit);
    const active = toolRef.current;
    if ((active === 'brush' || active === 'eraser')
      && event.pointerType === 'touch'
      && mobileStrokeModeRef.current === 'precision') {
      gestureRef.current = {
        kind: 'candidate',
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        hit,
        startHit: hit,
        cancelled: false,
        allowDrag: true,
        tool: active,
      };
      updateLoupe(event, hit);
      return;
    }
    if (active === 'brush' || active === 'eraser') {
      const snapshots = paintAtCell(hit.row, hit.col);
      gestureRef.current = {
        kind: 'stroke',
        pointerId: event.pointerId,
        lastCell: hit.row * stateRef.current.width + hit.col,
        snapshots,
      };
      if (snapshots.length > 0) setVersion((value) => value + 1);
      updateLoupe(event, hit);
      return;
    }
    if (active === 'fill' || active === 'pick') {
      gestureRef.current = {
        kind: 'candidate',
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        hit,
        startHit: hit,
        cancelled: false,
        allowDrag: layout === 'mobile' && (event.pointerType === 'touch' || event.pointerType === 'pen'),
        tool: active,
      };
      updateLoupe(event, hit);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = viewport.localPoint(event.clientX, event.clientY);
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size >= 2 && gestureRef.current.kind !== 'pinch') startPinch();
    const gesture = gestureRef.current;
    if (gesture.kind === 'pinch') {
      const first = pointersRef.current.get(gesture.ids[0]);
      const second = pointersRef.current.get(gesture.ids[1]);
      if (!first || !second) return;
      const center = midpoint(first, second);
      const nextCellPx = gesture.startCamera.cellPx * distance(first, second) / gesture.startDistance;
      const zoomed = zoomGridCameraAt(gesture.startCamera, nextCellPx, gesture.startCenter.x, gesture.startCenter.y);
      viewport.applyCamera(panGridCamera(zoomed, center.x - gesture.startCenter.x, center.y - gesture.startCenter.y));
      return;
    }
    if (gesture.kind === 'pan' && gesture.pointerId === event.pointerId) {
      viewport.panBy(point.x - gesture.lastX, point.y - gesture.lastY);
      gesture.lastX = point.x;
      gesture.lastY = point.y;
      return;
    }

    const hit = viewport.cellAtClientPoint(event.clientX, event.clientY);
    if (gesture.kind === 'candidate' && gesture.pointerId === event.pointerId) {
      if (!gesture.allowDrag) {
        if (Math.hypot(point.x - gesture.startX, point.y - gesture.startY) > MOVE_THRESHOLD_PX
          || !sameGridCell(hit, gesture.startHit)) gesture.cancelled = true;
        if (gesture.cancelled) updateLoupe(event, null);
        return;
      }
      if (!hit) gesture.cancelled = true;
      if (gesture.cancelled) {
        gesture.hit = null;
        updateLoupe(event, null);
        return;
      }
      gesture.hit = hit;
      if (hit) setCursor(hit);
      updateLoupe(event, hit);
      return;
    }
    if (gesture.kind === 'stroke' && gesture.pointerId === event.pointerId) {
      updateLoupe(event, hit);
      if (!hit) {
        cancelGesture();
        return;
      }
      const width = stateRef.current.width;
      const nextIndex = hit.row * width + hit.col;
      if (nextIndex === gesture.lastCell) return;
      const previousRow = Math.floor(gesture.lastCell / width);
      const previousCol = gesture.lastCell % width;
      const path = rasterizeGridLine(previousRow, previousCol, hit.row, hit.col);
      for (const cell of path.slice(1)) gesture.snapshots.push(...paintAtCell(cell.row, cell.col));
      gesture.lastCell = nextIndex;
      setCursor(hit);
      setVersion((value) => value + 1);
      return;
    }
    setCursor(hit);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = viewport.localPoint(event.clientX, event.clientY);
    const hit = viewport.cellAtClientPoint(event.clientX, event.clientY);
    const gesture = gestureRef.current;
    pointersRef.current.delete(event.pointerId);
    setLoupe(null);

    if (gesture.kind === 'pinch') {
      if (pointersRef.current.size < 2) gestureRef.current = { kind: 'idle' };
      return;
    }
    if (gesture.kind === 'pan' && gesture.pointerId === event.pointerId) {
      const moved = Math.hypot(point.x - gesture.startX, point.y - gesture.startY);
      if (moved <= MOVE_THRESHOLD_PX && sameGridCell(hit, gesture.hit)) setCursor(hit);
      gestureRef.current = { kind: 'idle' };
      return;
    }
    if (gesture.kind === 'stroke' && gesture.pointerId === event.pointerId) {
      if (!hit) {
        cancelGesture();
        return;
      }
      gestureRef.current = { kind: 'idle' };
      commit(toolRef.current === 'eraser' ? 'eraser' : 'brush', gesture.snapshots);
      return;
    }
    if (gesture.kind === 'candidate' && gesture.pointerId === event.pointerId) {
      gestureRef.current = { kind: 'idle' };
      if (gesture.cancelled || !hit || !gesture.hit) return;
      if (!gesture.allowDrag) {
        const moved = Math.hypot(point.x - gesture.startX, point.y - gesture.startY);
        if (moved > MOVE_THRESHOLD_PX || !sameGridCell(hit, gesture.startHit)) return;
      }
      const target = gesture.hit;
      if (gesture.tool === 'brush' || gesture.tool === 'eraser') {
        commit(gesture.tool, paintAtCell(target.row, target.col));
      } else if (gesture.tool === 'pick') pickAtCell(target.row, target.col);
      else commit('fill', floodFill(
        stateRef.current.cells,
        stateRef.current.width,
        stateRef.current.height,
        target.row,
        target.col,
        colorRef.current,
      ));
    }
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const gesture = gestureRef.current;
    if (gesture.kind === 'idle') {
      pointersRef.current.delete(event.pointerId);
      return;
    }
    const ownsGesture = gesture.kind === 'pinch'
      ? gesture.ids.includes(event.pointerId)
      : gesture.pointerId === event.pointerId;
    if (!ownsGesture) {
      pointersRef.current.delete(event.pointerId);
      return;
    }
    cancelGesture();
  };

  const undo = (): void => {
    if (cancelGesture()) return;
    const entry = historyRef.current.undo(stateRef.current.cells);
    if (!entry) return;
    if (entry.dims) {
      stateRef.current.width = entry.dims.before.width;
      stateRef.current.height = entry.dims.before.height;
    }
    setCursor(null);
    refreshStats(stateRef.current);
    syncFlags(stateRef.current.stats, stateRef.current.totalBeadCount);
  };

  const redo = (): void => {
    if (cancelGesture()) return;
    const entry = historyRef.current.redo(stateRef.current.cells);
    if (!entry) return;
    if (entry.dims) {
      stateRef.current.width = entry.dims.after.width;
      stateRef.current.height = entry.dims.after.height;
    }
    setCursor(null);
    refreshStats(stateRef.current);
    syncFlags(stateRef.current.stats, stateRef.current.totalBeadCount);
  };

  const onTransform = (op: TransformOp): void => {
    cancelGesture();
    const state = stateRef.current;
    const beforeCells = state.cells.slice();
    const beforeDims = { width: state.width, height: state.height };
    const transformed = applyTransform(state.cells, state.width, state.height, op);
    state.cells = transformed.cells;
    state.width = transformed.width;
    state.height = transformed.height;
    historyRef.current.push({
      label: 'transform',
      snapshots: beforeCells.map((cell, index) => ({ index, before: cell, after: state.cells[index] })),
      dims: { before: beforeDims, after: { width: transformed.width, height: transformed.height } },
    });
    setCursor(null);
    refreshStats(state);
    syncFlags(state.stats, state.totalBeadCount);
  };

  const confirmClear = (): void => {
    commit('clear', clearAll(stateRef.current.cells));
    setClearOpen(false);
  };

  const onReplaceSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const from = replaceFrom.trim();
    if (!from) return;
    const target = replaceTo === 'transparent' ? null : (availablePalette[Number(replaceTo)] ?? null);
    const count = commit('replace', replaceByCode(stateRef.current.cells, from, target));
    setReplaceMsg(count > 0 ? t.replaceCount(count) : t.replaceNone);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      spacePressedRef.current = true;
      return;
    }
    const selectTool = (next: ToolId): void => enterEditMode(next);
    switch (event.key.toLowerCase()) {
      case 'h': enterPanMode(); return;
      case 'b': selectTool('brush'); return;
      case 'e': selectTool('eraser'); return;
      case 'g': selectTool('fill'); return;
      case 'i': selectTool('pick'); return;
      case 'arrowup':
      case 'arrowdown':
      case 'arrowleft':
      case 'arrowright': {
        event.preventDefault();
        const base = cursor ?? { row: 0, col: 0 };
        const next = { ...base };
        if (event.key === 'ArrowUp') next.row = Math.max(0, next.row - 1);
        if (event.key === 'ArrowDown') next.row = Math.min(stateRef.current.height - 1, next.row + 1);
        if (event.key === 'ArrowLeft') next.col = Math.max(0, next.col - 1);
        if (event.key === 'ArrowRight') next.col = Math.min(stateRef.current.width - 1, next.col + 1);
        setCursor(next);
        viewport.centerCell(next.row, next.col);
        return;
      }
      case 'enter': {
        if (!cursor || interactionModeRef.current === 'pan') return;
        event.preventDefault();
        if (toolRef.current === 'pick') pickAtCell(cursor.row, cursor.col);
        else if (toolRef.current === 'fill') commit('fill', floodFill(
          stateRef.current.cells,
          stateRef.current.width,
          stateRef.current.height,
          cursor.row,
          cursor.col,
          colorRef.current,
        ));
        else commit(toolRef.current === 'eraser' ? 'eraser' : 'brush', paintAtCell(cursor.row, cursor.col));
        return;
      }
      default: return;
    }
  };

  const onKeyUp = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === ' ') spacePressedRef.current = false;
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const point = viewport.localPoint(event.clientX, event.clientY);
    viewport.zoomAt(readCamera().cellPx * Math.exp(-event.deltaY * 0.002), point.x, point.y);
  };

  const onStudioPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>): void => {
    if ((event.pointerType === 'touch' || event.pointerType === 'pen')
      && event.target !== canvasRef.current
      && gestureRef.current.kind !== 'idle') {
      cancelGesture();
    }
  };

  const filteredPalette = availablePalette.filter((color) => {
    const query = paletteQuery.trim().toLowerCase();
    if (!query) return true;
    return `${color.code ?? ''} ${color.hex}`.toLowerCase().includes(query);
  });

  const currentBoard = cursor
    ? { boardRow: Math.floor(cursor.row / boardSize), boardCol: Math.floor(cursor.col / boardSize) }
    : { boardRow: 0, boardCol: 0 };

  return (
    <div
      className={`pixel-editor-studio flex flex-col gap-2${layout === 'mobile' ? ' is-mobile' : ''}`}
      onPointerDownCapture={onStudioPointerDownCapture}
    >
      <EditorToolbar
        tool={tool}
        brushSize={brushSize}
        canUndo={canUndo}
        canRedo={canRedo}
        currentColor={currentColor}
        replaceCountMessage={replaceMsg}
        interactionMode={interactionMode}
        layout={layout}
        moreOpen={moreOpen}
        onPanMode={enterPanMode}
        onMoreToggle={() => setMoreOpen((open) => !open)}
        onToolChange={(next) => enterEditMode(next)}
        onBrushSizeChange={setBrushSizeState}
        onUndo={undo}
        onRedo={redo}
        onReplaceOpen={() => setReplaceOpen((open) => !open)}
        onClear={() => setClearOpen(true)}
        onTransform={onTransform}
      />

      {layout === 'mobile' && interactionMode === 'edit' && (tool === 'brush' || tool === 'eraser') && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-lilac/40 bg-white px-2 py-1.5 text-xs" role="group" aria-label={t.strokeMode}>
          <button
            type="button"
            aria-pressed={mobileStrokeMode === 'precision'}
            onClick={() => changeMobileStrokeMode('precision')}
            className={`editor-tool-button${mobileStrokeMode === 'precision' ? ' is-active' : ''}`}
          >
            {t.precisionMode}
          </button>
          <button
            type="button"
            aria-pressed={mobileStrokeMode === 'continuous'}
            onClick={() => changeMobileStrokeMode('continuous')}
            className={`editor-tool-button${mobileStrokeMode === 'continuous' ? ' is-active' : ''}`}
          >
            {t.continuousMode}
          </button>
          <span className="text-ink-soft">
            {mobileStrokeMode === 'precision' ? t.precisionHint : t.continuousHint}
          </span>
        </div>
      )}

      {editNotice && <p role="status" className="text-xs text-ink-soft">{editNotice}</p>}

      <section
        aria-label={t.paletteTray}
        className={`editor-palette-tray rounded-xl border border-lilac/40 bg-white p-2${layout === 'mobile' && !moreOpen ? ' is-collapsed' : ''}`}
      >
        <input
          type="search"
          value={paletteQuery}
          onChange={(event) => setPaletteQuery(event.target.value)}
          aria-label={t.paletteSearch}
          placeholder={t.paletteSearch}
          className="w-full input-compact"
        />
        <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-auto">
          {filteredPalette.map((color, index) => (
            <button
              type="button"
              key={`${color.hex}-${color.code ?? index}`}
              onClick={() => setColor(color)}
              aria-pressed={currentColor?.hex === color.hex && currentColor?.code === color.code}
              aria-label={`${color.code ?? color.hex} ${color.hex}`}
              className="flex items-center gap-1 rounded-lg border border-lilac/40 px-2 py-1 text-xs text-ink-soft hover:bg-lilac-soft aria-pressed:border-primary aria-pressed:bg-primary-soft"
            >
              <span className="h-3 w-3 rounded-sm border border-lilac/50" style={{ backgroundColor: color.hex }} />
              <span className="font-mono">{color.code ?? color.hex}</span>
            </button>
          ))}
          {filteredPalette.length === 0 && <p className="text-xs text-ink-soft">{t.paletteEmpty}</p>}
        </div>
      </section>

      {replaceOpen && (
        <form onSubmit={onReplaceSubmit} className="editor-more-drawer flex flex-wrap items-center gap-2 rounded-xl border border-lilac/40 p-2 text-sm">
          <label htmlFor="editor-replace-from" className="text-ink-soft">{t.replaceFrom}</label>
          <input id="editor-replace-from" value={replaceFrom} onChange={(event) => setReplaceFrom(event.target.value)} className="w-24 input-compact" />
          <ResponsiveSelect label={t.replaceTo} id="editor-replace-to" value={replaceTo} onValueChange={setReplaceTo}
            options={[...availablePalette.map((color,index)=>({value:String(index),label:color.code??color.hex,colors:[color.hex]})),{value:'transparent',label:t.excludeColor}]} />
          <button type="submit" className="rounded-lg border border-primary/60 bg-primary-soft px-2 py-1 text-primary-deep">{t.replaceConfirm}</button>
        </form>
      )}

      <div
        ref={viewport.viewportRef}
        tabIndex={0}
        aria-label={t.editorRegion}
        aria-describedby="editor-keyboard-status"
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => { spacePressedRef.current = false; }}
        onWheel={onWheel}
        className="grid-canvas-viewport editor-canvas-viewport outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <canvas
          ref={canvasRef}
          aria-label={t.canvasAria}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          style={{ touchAction: 'none', cursor: interactionMode === 'pan' ? 'grab' : tool === 'pick' ? 'copy' : 'crosshair' }}
        />
        <GridViewportControls
          cellPx={viewport.camera.cellPx}
          onZoomOut={() => viewport.zoomAt(readCamera().cellPx / 1.25, viewport.size.width / 2, viewport.size.height / 2)}
          onZoomIn={() => viewport.zoomAt(readCamera().cellPx * 1.25, viewport.size.width / 2, viewport.size.height / 2)}
          onFitBoard={() => viewport.fitBoard(currentBoard.boardRow, currentBoard.boardCol)}
          onFitPattern={viewport.fitPattern}
        />
        <div className="grid-coordinate-chip" aria-hidden="true">
          {cursor ? `${cursor.row + 1} : ${cursor.col + 1}` : `${stateRef.current.width} × ${stateRef.current.height}`}
        </div>
        <FingerLoupe
          pattern={{ width: stateRef.current.width, height: stateRef.current.height, cells: stateRef.current.cells }}
          target={loupe}
          viewportWidth={viewport.size.width}
          viewportHeight={viewport.size.height}
        />
        {scaleNotice && <div className="editor-scale-notice" role="status">{t.editScaleNotice}</div>}
      </div>

      <p id="editor-keyboard-status" className="text-xs text-ink-soft/80" role="status">
        {interactionMode === 'pan'
          ? t.panHint
          : tool === 'pick'
            ? t.pickHint
            : cursor
              ? t.cursorAt(cursor.row + 1, cursor.col + 1, cursorCellLabel(cursor.row, cursor.col))
              : t.cursorHint}
        {currentColor ? ` · ${currentColor.code ?? currentColor.hex}` : ` · ${t.noColor}`}
      </p>

      {clearOpen && (
        <Modal label={t.clearConfirmTitle} onClose={() => setClearOpen(false)} panelClassName="max-w-sm border-danger/40">
          <h3 className="text-sm font-medium text-danger">{t.clearConfirmTitle}</h3>
          <p className="mt-2 text-sm leading-6 text-ink-soft">{t.clearConfirmBody}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setClearOpen(false)} className="btn-outline btn-sm">{zhCN.designs.cancel}</button>
            <button type="button" onClick={confirmClear} className="rounded-full bg-danger px-3 py-1 text-sm text-white transition-colors hover:bg-danger">{t.clearConfirm}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
