'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  centerGridCameraOnCell,
  constrainGridCamera,
  fitBoardCamera,
  fitGridCamera,
  panGridCamera,
  screenPointToGridCell,
  zoomGridCameraAt,
  type GridCamera,
  type GridViewportSize,
} from '@/lib/render/gridViewport';
import { DEFAULT_BOARD_SIZE } from '@/lib/boardProfiles';

interface Options {
  patternWidth: number;
  patternHeight: number;
  boardSize?: number;
  initialBoard?: { boardRow: number; boardCol: number } | null;
  /** Existing deterministic editor tests can bypass layout measurement. */
  testCellPx?: number;
}

interface GridViewportController {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  size: GridViewportSize;
  /** Render snapshot. Event pipelines that must observe same-tick writes use readCamera(). */
  camera: GridCamera;
  readCamera: () => GridCamera;
  applyCamera: (camera: GridCamera) => void;
  localPoint: (clientX: number, clientY: number) => { x: number; y: number };
  cellAtClientPoint: (clientX: number, clientY: number) => { row: number; col: number } | null;
  panBy: (dx: number, dy: number) => void;
  zoomAt: (nextCellPx: number, x: number, y: number) => void;
  fitPattern: () => void;
  fitBoard: (boardRow: number, boardCol: number) => void;
  centerCell: (row: number, col: number) => void;
}

const FALLBACK_VIEWPORT: GridViewportSize = { width: 640, height: 520 };

export default function useGridViewport({
  patternWidth,
  patternHeight,
  boardSize = DEFAULT_BOARD_SIZE,
  initialBoard = null,
  testCellPx,
}: Options): GridViewportController {
  const viewportRef = useRef<HTMLDivElement>(null);
  // Callers naturally construct this tiny descriptor inline. Depend on its
  // primitive coordinates so a render cannot recreate the ResizeObserver
  // effect and feed a setSize -> render loop.
  const initialBoardRow = initialBoard?.boardRow ?? null;
  const initialBoardCol = initialBoard?.boardCol ?? null;
  const hasInitialBoard = initialBoardRow !== null && initialBoardCol !== null;
  const initialSize = useMemo<GridViewportSize>(() => (
    testCellPx
      ? {
          width: Math.max(1, patternWidth * testCellPx),
          height: Math.max(1, patternHeight * testCellPx),
        }
      : FALLBACK_VIEWPORT
  ), [patternHeight, patternWidth, testCellPx]);
  const [size, setSize] = useState(initialSize);
  const [camera, setCamera] = useState<GridCamera>(() => (
    testCellPx
      ? { cellPx: testCellPx, offsetX: 0, offsetY: 0 }
      : hasInitialBoard
        ? fitBoardCamera(patternWidth, patternHeight, initialBoardRow, initialBoardCol, initialSize, boardSize)
        : fitGridCamera(patternWidth, patternHeight, initialSize)
  ));
  const cameraRef = useRef(camera);
  const measuredRef = useRef(false);
  const dimensionsRef = useRef(`${patternWidth}x${patternHeight}`);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof ResizeObserver === 'undefined' || testCellPx) return;
    const applySize = (width: number, height: number): void => {
      if (width <= 0 || height <= 0) return;
      const nextSize = { width: Math.floor(width), height: Math.floor(height) };
      setSize((previous) => (
        previous.width === nextSize.width && previous.height === nextSize.height
          ? previous
          : nextSize
      ));
      setCamera((previous) => {
        if (!measuredRef.current) {
          measuredRef.current = true;
          return hasInitialBoard
            ? fitBoardCamera(patternWidth, patternHeight, initialBoardRow, initialBoardCol, nextSize, boardSize)
            : fitGridCamera(patternWidth, patternHeight, nextSize);
        }
        const next = constrainGridCamera(previous, patternWidth, patternHeight, nextSize);
        return next.cellPx === previous.cellPx
          && next.offsetX === previous.offsetX
          && next.offsetY === previous.offsetY
          ? previous
          : next;
      });
    };
    applySize(element.clientWidth, element.clientHeight);
    const observer = new ResizeObserver(([entry]) => {
      applySize(entry?.contentRect.width ?? 0, entry?.contentRect.height ?? 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [boardSize, hasInitialBoard, initialBoardCol, initialBoardRow, patternHeight, patternWidth, testCellPx]);

  useEffect(() => {
    const nextDimensions = `${patternWidth}x${patternHeight}`;
    if (nextDimensions === dimensionsRef.current) return;
    dimensionsRef.current = nextDimensions;
    setCamera(hasInitialBoard
      ? fitBoardCamera(patternWidth, patternHeight, initialBoardRow, initialBoardCol, size, boardSize)
      : fitGridCamera(patternWidth, patternHeight, size));
  }, [boardSize, hasInitialBoard, initialBoardCol, initialBoardRow, patternHeight, patternWidth, size]);

  const localPoint = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return {
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
    };
  }, []);

  const cellAtClientPoint = useCallback((clientX: number, clientY: number) => {
    const point = localPoint(clientX, clientY);
    return screenPointToGridCell(point.x, point.y, cameraRef.current, patternWidth, patternHeight);
  }, [localPoint, patternHeight, patternWidth]);

  const updateCamera = useCallback((next: GridCamera): void => {
    const constrained = constrainGridCamera(next, patternWidth, patternHeight, size);
    cameraRef.current = constrained;
    setCamera(constrained);
  }, [patternHeight, patternWidth, size]);

  const readCamera = useCallback((): GridCamera => cameraRef.current, []);

  const panBy = useCallback((dx: number, dy: number): void => {
    updateCamera(panGridCamera(cameraRef.current, dx, dy));
  }, [updateCamera]);

  const zoomAt = useCallback((nextCellPx: number, x: number, y: number): void => {
    updateCamera(zoomGridCameraAt(cameraRef.current, nextCellPx, x, y));
  }, [updateCamera]);

  const fitPattern = useCallback((): void => {
    const next = fitGridCamera(patternWidth, patternHeight, size);
    cameraRef.current = next;
    setCamera(next);
  }, [patternHeight, patternWidth, size]);

  const fitBoard = useCallback((boardRow: number, boardCol: number): void => {
    const next = fitBoardCamera(patternWidth, patternHeight, boardRow, boardCol, size, boardSize);
    cameraRef.current = next;
    setCamera(next);
  }, [boardSize, patternHeight, patternWidth, size]);

  const centerCell = useCallback((row: number, col: number): void => {
    updateCamera(centerGridCameraOnCell(cameraRef.current, row, col, size));
  }, [size, updateCamera]);

  return {
    viewportRef,
    size,
    camera,
    readCamera,
    applyCamera: updateCamera,
    localPoint,
    cellAtClientPoint,
    panBy,
    zoomAt,
    fitPattern,
    fitBoard,
    centerCell,
  };
}
