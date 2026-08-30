/**
 * 跟拼进度（G-1）：记录「这张图纸已经拼到哪些格子」。
 *
 * 为什么需要：拼一张 100×63 的图要几个小时甚至几天，中途必然放下。
 * 没有进度记录时用户只能靠肉眼在纸质图纸上找位置，或者用手指按着屏幕，
 * 这是竞品普遍具备（4/8）而豆谱完全空白的一环。
 *
 * 数据形态：每格 1 字节的 Uint8Array（0 未拼 / 1 已拼）。
 * 200×200 也只有 40 KB，IndexedDB 直接存二进制不需要序列化成 JSON 数组
 * （JSON 化会膨胀到 80 KB 以上并拖慢每次保存）。
 *
 * 与图纸的关系：进度按 designId 存，并记录当时的宽高。图纸被重新生成或
 * 变换尺寸后宽高不再匹配，进度即失效（宁可让用户重新开始，也不能把
 * 「已拼」标记错位到别的格子上）。
 */
import { DEFAULT_BOARD_SIZE } from '@/lib/boardProfiles';

export const STITCH_PROGRESS_VERSION = 1 as const;

export interface StitchProgress {
  version: typeof STITCH_PROGRESS_VERSION;
  width: number;
  height: number;
  /** 长度 = width × height，每格 0/1 */
  done: Uint8Array;
  updatedAt: string;
}

export type StitchCell = {
  hex: string | null;
  transparent: boolean;
  external?: boolean;
};

/** 跟拼领域唯一的可拼格判定：必须有颜色，且不是透明/背景外部格。 */
export function isStitchableCell(cell: StitchCell | null | undefined): cell is StitchCell {
  return Boolean(cell?.hex) && cell?.transparent === false && cell.external !== true;
}

export interface BoardRect {
  rowStart: number;
  rowEndExclusive: number;
  colStart: number;
  colEndExclusive: number;
  width: number;
  height: number;
}

/** 取得指定板块在整张图纸中的范围；边缘板块会按图纸尺寸裁剪。 */
export function getBoardRect(
  patternWidth: number,
  patternHeight: number,
  boardRow: number,
  boardCol: number,
  boardSize = DEFAULT_BOARD_SIZE,
): BoardRect | null {
  if (
    !Number.isInteger(patternWidth)
    || !Number.isInteger(patternHeight)
    || !Number.isInteger(boardRow)
    || !Number.isInteger(boardCol)
    || !Number.isInteger(boardSize)
    || patternWidth <= 0
    || patternHeight <= 0
    || boardRow < 0
    || boardCol < 0
    || boardSize <= 0
  ) return null;

  const rowStart = boardRow * boardSize;
  const colStart = boardCol * boardSize;
  if (rowStart >= patternHeight || colStart >= patternWidth) return null;
  const rowEndExclusive = Math.min(patternHeight, rowStart + boardSize);
  const colEndExclusive = Math.min(patternWidth, colStart + boardSize);
  return {
    rowStart,
    rowEndExclusive,
    colStart,
    colEndExclusive,
    width: colEndExclusive - colStart,
    height: rowEndExclusive - rowStart,
  };
}

export interface StitchTarget {
  boardRow: number;
  boardCol: number;
  /** 目标所在板块内的行号（0-based）。 */
  localRow: number;
  /** 目标在整张图纸中的行列（0-based）。 */
  row: number;
  col: number;
}

/**
 * 寻找下一颗未拼的豆：板块横向优先，板块内逐行逐列。
 * 空板、空行以及透明/背景外部格会被直接跳过。
 */
export function findNextStitchTarget(
  progress: StitchProgress,
  cells: readonly StitchCell[],
  boardSize = DEFAULT_BOARD_SIZE,
): StitchTarget | null {
  if (!Number.isInteger(boardSize) || boardSize <= 0) return null;
  const boardRows = Math.ceil(progress.height / boardSize);
  const boardCols = Math.ceil(progress.width / boardSize);
  for (let boardRow = 0; boardRow < boardRows; boardRow++) {
    for (let boardCol = 0; boardCol < boardCols; boardCol++) {
      const rect = getBoardRect(progress.width, progress.height, boardRow, boardCol, boardSize);
      if (!rect) continue;
      for (let row = rect.rowStart; row < rect.rowEndExclusive; row++) {
        for (let col = rect.colStart; col < rect.colEndExclusive; col++) {
          const index = row * progress.width + col;
          if (isStitchableCell(cells[index]) && progress.done[index] !== 1) {
            return { boardRow, boardCol, localRow: row - rect.rowStart, row, col };
          }
        }
      }
    }
  }
  return null;
}

/**
 * 标记当前板块的一条局部行。只改动这一板范围内真正需要拼的格子；
 * 相邻板块、透明格与背景外部格保持原样。
 */
export function setBoardRowDone(
  progress: StitchProgress,
  cells: readonly StitchCell[],
  boardRow: number,
  boardCol: number,
  localRow: number,
  value: boolean,
  now = new Date(),
  boardSize = DEFAULT_BOARD_SIZE,
): StitchProgress {
  const rect = getBoardRect(progress.width, progress.height, boardRow, boardCol, boardSize);
  if (!rect || !Number.isInteger(localRow) || localRow < 0 || localRow >= rect.height) return progress;

  const row = rect.rowStart + localRow;
  const nextValue = value ? 1 : 0;
  let done: Uint8Array | null = null;
  for (let col = rect.colStart; col < rect.colEndExclusive; col++) {
    const index = row * progress.width + col;
    if (!isStitchableCell(cells[index]) || progress.done[index] === nextValue) continue;
    done ??= progress.done.slice();
    done[index] = nextValue;
  }
  return done ? { ...progress, done, updatedAt: now.toISOString() } : progress;
}

/** 空行不算完成；存在可拼格时，只有这一板局部行的可拼格全部已拼才返回 true。 */
export function isBoardRowDone(
  progress: StitchProgress,
  cells: readonly StitchCell[],
  boardRow: number,
  boardCol: number,
  localRow: number,
  boardSize = DEFAULT_BOARD_SIZE,
): boolean {
  const rect = getBoardRect(progress.width, progress.height, boardRow, boardCol, boardSize);
  if (!rect || !Number.isInteger(localRow) || localRow < 0 || localRow >= rect.height) return false;

  const row = rect.rowStart + localRow;
  let hasStitchableCell = false;
  for (let col = rect.colStart; col < rect.colEndExclusive; col++) {
    const index = row * progress.width + col;
    if (!isStitchableCell(cells[index])) continue;
    hasStitchableCell = true;
    if (progress.done[index] !== 1) return false;
  }
  return hasStitchableCell;
}

export function createStitchProgress(width: number, height: number, now = new Date()): StitchProgress {
  return {
    version: STITCH_PROGRESS_VERSION,
    width,
    height,
    done: new Uint8Array(Math.max(0, width * height)),
    updatedAt: now.toISOString(),
  };
}

/** 进度是否仍与当前图纸对应（尺寸一致且长度自洽）。 */
export function isProgressCompatible(
  progress: StitchProgress | null,
  pattern: { width: number; height: number },
): progress is StitchProgress {
  return progress !== null
    && progress.version === STITCH_PROGRESS_VERSION
    && progress.width === pattern.width
    && progress.height === pattern.height
    && progress.done.length === pattern.width * pattern.height;
}

/** 反序列化（IndexedDB 里可能是 Uint8Array，也可能被结构化克隆成 ArrayBuffer）。 */
export function parseStitchProgress(value: unknown): StitchProgress | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { version?: unknown; width?: unknown; height?: unknown; done?: unknown; updatedAt?: unknown };
  if (raw.version !== STITCH_PROGRESS_VERSION) return null;
  if (!Number.isInteger(raw.width) || !Number.isInteger(raw.height)) return null;
  const rawDone: unknown = raw.done;
  const done = rawDone instanceof Uint8Array
    ? rawDone
    : rawDone instanceof ArrayBuffer
      ? new Uint8Array(rawDone)
      : null;
  if (!done) return null;
  const width = raw.width as number;
  const height = raw.height as number;
  if (done.length !== width * height) return null;
  return {
    version: STITCH_PROGRESS_VERSION,
    width,
    height,
    done,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  };
}

/** 切换单格；返回新对象（不原地修改，便于 React 比较）。 */
export function toggleCell(progress: StitchProgress, row: number, col: number, now = new Date()): StitchProgress {
  if (row < 0 || col < 0 || row >= progress.height || col >= progress.width) return progress;
  const index = row * progress.width + col;
  const done = progress.done.slice();
  done[index] = done[index] === 1 ? 0 : 1;
  return { ...progress, done, updatedAt: now.toISOString() };
}

/** 整行标记（拼豆是一行一行拼的，逐格点完整板宽不现实）。 */
export function setRowDone(
  progress: StitchProgress,
  row: number,
  value: boolean,
  now = new Date(),
): StitchProgress {
  if (row < 0 || row >= progress.height) return progress;
  const done = progress.done.slice();
  done.fill(value ? 1 : 0, row * progress.width, (row + 1) * progress.width);
  return { ...progress, done, updatedAt: now.toISOString() };
}

export function clearProgress(progress: StitchProgress, now = new Date()): StitchProgress {
  return { ...progress, done: new Uint8Array(progress.done.length), updatedAt: now.toISOString() };
}

export interface ProgressSummary {
  /** 需要拼的格子总数（不含透明与背景格） */
  total: number;
  doneCount: number;
  /** 0–100，保留一位小数 */
  percent: number;
  /** 第一行仍未拼完的行号（0-based）；全部完成时为 null */
  nextRow: number | null;
}

/**
 * 汇总进度。只统计「需要拼的格子」：透明格与被判为背景的外部格不算分母，
 * 否则一张带大片透明的图永远到不了 100%。
 */
export function summarizeProgress(
  progress: StitchProgress,
  cells: readonly StitchCell[],
): ProgressSummary {
  let total = 0;
  let doneCount = 0;
  let nextRow: number | null = null;
  for (let row = 0; row < progress.height; row++) {
    let rowHasPending = false;
    for (let col = 0; col < progress.width; col++) {
      const index = row * progress.width + col;
      const cell = cells[index];
      if (!isStitchableCell(cell)) continue;
      total += 1;
      if (progress.done[index] === 1) doneCount += 1;
      else rowHasPending = true;
    }
    if (rowHasPending && nextRow === null) nextRow = row;
  }
  return {
    total,
    doneCount,
    percent: total > 0 ? Math.round((doneCount / total) * 1000) / 10 : 0,
    nextRow,
  };
}
