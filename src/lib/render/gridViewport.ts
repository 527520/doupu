/**
 * 有界网格画布的纯相机数学。
 *
 * 本模块只使用 CSS 像素；DPR 仅由 Canvas 绘制适配器处理，不能进入相机或命中计算。
 */
import { DEFAULT_BOARD_SIZE } from '@/lib/boardProfiles';

export type GridCamera = {
  /** 单格边长，单位 CSS px，始终钳制到 1..64。 */
  cellPx: number;
  /** 图纸左上角相对视窗左上角的 CSS px 偏移。 */
  offsetX: number;
  offsetY: number;
};

export type GridViewportSize = {
  width: number;
  height: number;
};

export type GridRange = {
  /** 行列均为左闭右开的图纸坐标范围。 */
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
};

const MIN_CELL_PX = 1;
const MAX_CELL_PX = 64;

function clampCellPx(value: number): number {
  if (!Number.isFinite(value)) return MIN_CELL_PX;
  return Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, value));
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function safeCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function safeCamera(camera: GridCamera): GridCamera {
  return {
    cellPx: clampCellPx(camera.cellPx),
    offsetX: safeCoordinate(camera.offsetX),
    offsetY: safeCoordinate(camera.offsetY),
  };
}

function safePadding(value: number | undefined, viewport: GridViewportSize): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return 0;
  return Math.min(value as number, Math.max(0, Math.min(viewport.width, viewport.height) / 2 - 0.5));
}

export function fitGridCamera(
  patternW: number,
  patternH: number,
  viewport: GridViewportSize,
  padding = 0,
): GridCamera {
  if (
    !isPositiveFinite(patternW) ||
    !isPositiveFinite(patternH) ||
    !isPositiveFinite(viewport.width) ||
    !isPositiveFinite(viewport.height)
  ) {
    return { cellPx: MIN_CELL_PX, offsetX: 0, offsetY: 0 };
  }

  const inset = safePadding(padding, viewport);
  const availableWidth = viewport.width - inset * 2;
  const availableHeight = viewport.height - inset * 2;
  const cellPx = clampCellPx(Math.min(availableWidth / patternW, availableHeight / patternH));

  return {
    cellPx,
    offsetX: (viewport.width - patternW * cellPx) / 2,
    offsetY: (viewport.height - patternH * cellPx) / 2,
  };
}

/** 以零基板块行列定位，并按边缘残板的实际尺寸适配。 */
export function fitBoardCamera(
  patternW: number,
  patternH: number,
  boardRow: number,
  boardCol: number,
  viewport: GridViewportSize,
  boardSize = DEFAULT_BOARD_SIZE,
  padding = 0,
): GridCamera {
  if (
    !isPositiveFinite(patternW) ||
    !isPositiveFinite(patternH) ||
    !isPositiveFinite(viewport.width) ||
    !isPositiveFinite(viewport.height)
  ) {
    return { cellPx: MIN_CELL_PX, offsetX: 0, offsetY: 0 };
  }

  const size = isPositiveFinite(boardSize) ? Math.max(1, Math.floor(boardSize)) : DEFAULT_BOARD_SIZE;
  const boardRows = Math.ceil(patternH / size);
  const boardCols = Math.ceil(patternW / size);
  const row = Math.min(
    boardRows - 1,
    Number.isFinite(boardRow) ? Math.max(0, Math.floor(boardRow)) : 0,
  );
  const col = Math.min(
    boardCols - 1,
    Number.isFinite(boardCol) ? Math.max(0, Math.floor(boardCol)) : 0,
  );
  const rowStart = row * size;
  const colStart = col * size;
  const boardHeight = Math.min(size, patternH - rowStart);
  const boardWidth = Math.min(size, patternW - colStart);
  const inset = safePadding(padding, viewport);
  const cellPx = clampCellPx(
    Math.min(
      (viewport.width - inset * 2) / boardWidth,
      (viewport.height - inset * 2) / boardHeight,
    ),
  );

  return {
    cellPx,
    offsetX: viewport.width / 2 - (colStart + boardWidth / 2) * cellPx,
    offsetY: viewport.height / 2 - (rowStart + boardHeight / 2) * cellPx,
  };
}

/** 将目标格子的中心移到视窗中心；不会自动约束图纸边缘。 */
export function centerGridCameraOnCell(
  camera: GridCamera,
  row: number,
  col: number,
  viewport: GridViewportSize,
): GridCamera {
  const current = safeCamera(camera);
  if (!isPositiveFinite(viewport.width) || !isPositiveFinite(viewport.height)) return current;
  const targetRow = Number.isFinite(row) ? Math.max(0, Math.floor(row)) : 0;
  const targetCol = Number.isFinite(col) ? Math.max(0, Math.floor(col)) : 0;

  return {
    cellPx: current.cellPx,
    offsetX: viewport.width / 2 - (targetCol + 0.5) * current.cellPx,
    offsetY: viewport.height / 2 - (targetRow + 0.5) * current.cellPx,
  };
}

/** 将相机限制到可达范围：小图居中，大图保留两侧边缘。 */
export function constrainGridCamera(
  camera: GridCamera,
  patternW: number,
  patternH: number,
  viewport: GridViewportSize,
  overscroll = 0,
): GridCamera {
  const current = safeCamera(camera);
  if (
    !isPositiveFinite(patternW) ||
    !isPositiveFinite(patternH) ||
    !isPositiveFinite(viewport.width) ||
    !isPositiveFinite(viewport.height)
  ) {
    return current;
  }

  const contentWidth = patternW * current.cellPx;
  const contentHeight = patternH * current.cellPx;
  const margin = Number.isFinite(overscroll) ? Math.max(0, overscroll) : 0;
  const constrainAxis = (offset: number, contentSize: number, viewportSize: number): number => {
    if (contentSize <= viewportSize) return (viewportSize - contentSize) / 2;
    return Math.min(margin, Math.max(viewportSize - contentSize - margin, offset));
  };
  return {
    cellPx: current.cellPx,
    offsetX: constrainAxis(current.offsetX, contentWidth, viewport.width),
    offsetY: constrainAxis(current.offsetY, contentHeight, viewport.height),
  };
}

/** 围绕屏幕锚点缩放，使锚点下的世界坐标保持不变。 */
export function zoomGridCameraAt(
  camera: GridCamera,
  nextCellPx: number,
  anchorX: number,
  anchorY: number,
): GridCamera {
  const current = safeCamera(camera);
  const next = clampCellPx(nextCellPx);
  const x = safeCoordinate(anchorX);
  const y = safeCoordinate(anchorY);
  const worldX = (x - current.offsetX) / current.cellPx;
  const worldY = (y - current.offsetY) / current.cellPx;

  return {
    cellPx: next,
    offsetX: x - worldX * next,
    offsetY: y - worldY * next,
  };
}

/** 累加 CSS 像素平移；导航层可在平移结束后再调用约束。 */
export function panGridCamera(camera: GridCamera, dx: number, dy: number): GridCamera {
  const current = safeCamera(camera);
  return {
    cellPx: current.cellPx,
    offsetX: current.offsetX + safeCoordinate(dx),
    offsetY: current.offsetY + safeCoordinate(dy),
  };
}

/** 将视窗内 CSS 像素点换算为图纸格子，越界或非法输入返回 null。 */
export function screenPointToGridCell(
  screenX: number,
  screenY: number,
  camera: GridCamera,
  patternW: number,
  patternH: number,
): { row: number; col: number } | null {
  if (
    !Number.isFinite(screenX) ||
    !Number.isFinite(screenY) ||
    !isPositiveFinite(patternW) ||
    !isPositiveFinite(patternH)
  ) {
    return null;
  }

  const current = safeCamera(camera);
  const col = Math.floor((screenX - current.offsetX) / current.cellPx);
  const row = Math.floor((screenY - current.offsetY) / current.cellPx);
  if (col < 0 || col >= patternW || row < 0 || row >= patternH) return null;
  return { row, col };
}

/** 返回当前视窗附近的左闭右开格子范围，四周包含一格绘制缓冲。 */
export function visibleGridRange(
  camera: GridCamera,
  patternW: number,
  patternH: number,
  viewport: GridViewportSize,
): GridRange {
  const empty = { rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 };
  if (
    !isPositiveFinite(patternW) ||
    !isPositiveFinite(patternH) ||
    !isPositiveFinite(viewport.width) ||
    !isPositiveFinite(viewport.height)
  ) {
    return empty;
  }

  const current = safeCamera(camera);
  const cols = Math.floor(patternW);
  const rows = Math.floor(patternH);
  const colStart = Math.min(cols, Math.max(0, Math.floor(-current.offsetX / current.cellPx) - 1));
  const colEnd = Math.min(
    cols,
    Math.max(0, Math.ceil((viewport.width - current.offsetX) / current.cellPx) + 1),
  );
  const rowStart = Math.min(rows, Math.max(0, Math.floor(-current.offsetY / current.cellPx) - 1));
  const rowEnd = Math.min(
    rows,
    Math.max(0, Math.ceil((viewport.height - current.offsetY) / current.cellPx) + 1),
  );

  return {
    rowStart: Math.min(rowStart, rowEnd),
    rowEnd,
    colStart: Math.min(colStart, colEnd),
    colEnd,
  };
}
