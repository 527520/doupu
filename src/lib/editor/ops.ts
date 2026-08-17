/**
 * 编辑操作纯函数（spec §F5）：画笔/橡皮/油漆桶/全局替换/清除。
 * 所有操作以「快照」形式记录受影响格的前后值；格子对象只整槽替换、从不原地修改。
 */
import type { PaletteColor, PatternCell } from '@/lib/types';

export type ToolId = 'brush' | 'eraser' | 'fill' | 'pick' | 'replace' | 'clear' | 'transform';

export type BrushSize = 1 | 2 | 3;

export interface EditSnapshot {
  index: number;
  before: PatternCell;
  after: PatternCell;
}

/** Bresenham grid traversal used to make sparse pointer events a continuous stroke. */
export function rasterizeGridLine(
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
): Array<{ row: number; col: number }> {
  const points: Array<{ row: number; col: number }> = [];
  let x = fromCol;
  let y = fromRow;
  const dx = Math.abs(toCol - fromCol);
  const sx = fromCol < toCol ? 1 : -1;
  const dy = -Math.abs(toRow - fromRow);
  const sy = fromRow < toRow ? 1 : -1;
  let error = dx + dy;

  while (true) {
    points.push({ row: y, col: x });
    if (x === toCol && y === toRow) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
}

/** Restores a cancelled edit transaction, including overlapping brush cells. */
export function rollbackSnapshots(cells: PatternCell[], snapshots: readonly EditSnapshot[]): void {
  for (let index = snapshots.length - 1; index >= 0; index--) {
    const snapshot = snapshots[index];
    cells[snapshot.index] = snapshot.before;
  }
}

/** 单元格相等性（hex/code/transparent/external 全同）。 */
export function sameCell(a: PatternCell, b: PatternCell): boolean {
  return (
    a.hex === b.hex &&
    a.code === b.code &&
    a.transparent === b.transparent &&
    (a.external ?? false) === (b.external ?? false)
  );
}

export function makeSolid(hex: string, code: string | null): PatternCell {
  return { hex, code, transparent: false };
}

export function makeTransparent(): PatternCell {
  return { hex: null, code: null, transparent: true };
}

/** 以 (centerRow,centerCol) 为中心的 size×size 范围（钳制到图纸内，确定性）。 */
export function brushBounds(
  centerRow: number,
  centerCol: number,
  size: BrushSize,
  W: number,
  H: number,
): { r0: number; r1: number; c0: number; c1: number } {
  const offset = Math.floor((size - 1) / 2);
  const r0 = Math.max(0, Math.min(H - 1, centerRow - offset));
  const c0 = Math.max(0, Math.min(W - 1, centerCol - offset));
  return { r0, r1: Math.min(H, r0 + size), c0, c1: Math.min(W, c0 + size) };
}

/** 画笔：中心 size×size 区域涂为目标色（透明格变实心；外部标记清除）。 */
export function applyBrush(
  cells: PatternCell[],
  W: number,
  H: number,
  centerRow: number,
  centerCol: number,
  size: BrushSize,
  color: PaletteColor,
): EditSnapshot[] {
  const { r0, r1, c0, c1 } = brushBounds(centerRow, centerCol, size, W, H);
  const after = makeSolid(color.hex, color.code);
  const snapshots: EditSnapshot[] = [];
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const i = r * W + c;
      if (sameCell(cells[i], after)) continue;
      snapshots.push({ index: i, before: cells[i], after });
      cells[i] = after;
    }
  }
  return snapshots;
}

/** 橡皮：中心 size×size 区域置透明（已是透明格跳过）。 */
export function applyErase(
  cells: PatternCell[],
  W: number,
  H: number,
  centerRow: number,
  centerCol: number,
  size: BrushSize,
): EditSnapshot[] {
  const { r0, r1, c0, c1 } = brushBounds(centerRow, centerCol, size, W, H);
  const after = makeTransparent();
  const snapshots: EditSnapshot[] = [];
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const i = r * W + c;
      if (cells[i].transparent) continue;
      snapshots.push({ index: i, before: cells[i], after });
      cells[i] = after;
    }
  }
  return snapshots;
}

/**
 * 油漆桶（E22）：四连通泛洪，仅填充「同状态」连通格——
 * 起点透明 → 填充连通的透明区域；起点实心 → 填充与该格同 hex 的连通区域。
 * target 为 null 时表示橡皮填充（置透明）。起点已与目标一致 → 返回空（幂等）。
 */
export function floodFill(
  cells: PatternCell[],
  W: number,
  H: number,
  row: number,
  col: number,
  target: PaletteColor | null,
): EditSnapshot[] {
  const start = row * W + col;
  const after = target === null ? makeTransparent() : makeSolid(target.hex, target.code);
  if (sameCell(cells[start], after)) return [];

  const transparentGroup = cells[start].transparent;
  const groupHex = cells[start].hex;
  const visited = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  visited[start] = 1;
  const snapshots: EditSnapshot[] = [];

  while (head < tail) {
    const idx = queue[head++];
    snapshots.push({ index: idx, before: cells[idx], after });
    cells[idx] = after;
    const x = idx % W;
    const y = (idx / W) | 0;
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const;
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (visited[ni] === 1) continue;
      const neighbor = cells[ni];
      const sameGroup = transparentGroup ? neighbor.transparent : !neighbor.transparent && neighbor.hex === groupHex;
      if (!sameGroup) continue;
      visited[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return snapshots;
}

/**
 * 全局替换（E23）：按色号匹配非透明格，替换为目标色（或排除=置透明）。
 * 幂等：目标与现状一致跳过；不存在的色号 → 零快照。
 */
export function replaceByCode(
  cells: PatternCell[],
  fromCode: string,
  target: PaletteColor | null,
): EditSnapshot[] {
  const after = target === null ? makeTransparent() : makeSolid(target.hex, target.code);
  const snapshots: EditSnapshot[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.transparent || cell.code !== fromCode) continue;
    if (sameCell(cell, after)) continue;
    snapshots.push({ index: i, before: cell, after });
    cells[i] = after;
  }
  return snapshots;
}

/** 清除全部：所有非透明格置透明。 */
export function clearAll(cells: PatternCell[]): EditSnapshot[] {
  const after = makeTransparent();
  const snapshots: EditSnapshot[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].transparent) continue;
    snapshots.push({ index: i, before: cells[i], after });
    cells[i] = after;
  }
  return snapshots;
}

// ---------- 镜像/旋转（优化票 09） ----------

export type TransformOp = 'mirrorH' | 'mirrorV' | 'rotateCW' | 'rotateCCW';

export interface TransformResult {
  cells: PatternCell[];
  width: number;
  height: number;
}

/**
 * 整图变换：左右/上下翻转（尺寸不变）与顺/逆时针 90° 旋转（宽高互换）。
 * 格子对象整槽复制（含 transparent/external 标志），不改入参。
 * 结果数组与入参等长（旋转保持格子总数），索引按目标坐标系排布。
 */
export function applyTransform(cells: PatternCell[], W: number, H: number, op: TransformOp): TransformResult {
  const out = new Array<PatternCell>(cells.length);
  switch (op) {
    case 'mirrorH': {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          out[y * W + (W - 1 - x)] = { ...cells[y * W + x] };
        }
      }
      return { cells: out, width: W, height: H };
    }
    case 'mirrorV': {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          out[y * W + x] = { ...cells[(H - 1 - y) * W + x] };
        }
      }
      return { cells: out, width: W, height: H };
    }
    case 'rotateCW': {
      // 新坐标系 (x', y')：x' = H-1-y，y' = x；新宽 = H，新高 = W
      const newW = H;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          out[x * newW + (H - 1 - y)] = { ...cells[y * W + x] };
        }
      }
      return { cells: out, width: H, height: W };
    }
    case 'rotateCCW': {
      // 新坐标系 (x', y')：x' = y，y' = W-1-x；新宽 = H，新高 = W
      const newW = H;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          out[(W - 1 - x) * newW + y] = { ...cells[y * W + x] };
        }
      }
      return { cells: out, width: H, height: W };
    }
  }
}
