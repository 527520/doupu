/**
 * 编辑器状态编排：cells 副本 + 用量统计联动（复用引擎 computeStats，spec §F5）。
 * 纯数据操作，供 React 组件与单测共用；200×200 单操作预算 <50ms。
 */
import { computeStats } from '@/lib/engine/generate';
import type { PaletteColor, Pattern, PatternCell, PatternStatsItem } from '@/lib/types';
import {
  applyBrush,
  applyErase,
  clearAll,
  floodFill,
  replaceByCode,
  type BrushSize,
  type EditSnapshot,
  type ToolId,
} from './ops';
import { EditHistory } from './history';

export interface EditorState {
  cells: PatternCell[];
  width: number;
  height: number;
  stats: PatternStatsItem[];
  totalBeadCount: number;
}

function recompute(cells: PatternCell[]): Pick<EditorState, 'stats' | 'totalBeadCount'> {
  const stats = computeStats(cells);
  return { stats, totalBeadCount: stats.reduce((sum, item) => sum + item.count, 0) };
}

/** 从图纸创建编辑器状态（cells 为副本，不修改原 pattern）。 */
export function createEditorState(pattern: Pattern): EditorState {
  const cells = pattern.cells.map((cell) => ({ ...cell }));
  return { cells, width: pattern.width, height: pattern.height, ...recompute(cells) };
}

/** 用量统计重算（编辑操作后调用）。 */
export function refreshStats(state: EditorState): void {
  const { stats, totalBeadCount } = recompute(state.cells);
  state.stats = stats;
  state.totalBeadCount = totalBeadCount;
}

/** 提交一批快照为一个历史条目并刷新统计；返回快照数。 */
export function commitSnapshots(
  state: EditorState,
  history: EditHistory,
  label: ToolId,
  snapshots: EditSnapshot[],
): number {
  if (snapshots.length > 0) {
    history.push({ label, snapshots });
    refreshStats(state);
  }
  return snapshots.length;
}

export function paintBrush(
  state: EditorState,
  history: EditHistory,
  row: number,
  col: number,
  size: BrushSize,
  color: PaletteColor,
): number {
  return commitSnapshots(state, history, 'brush', applyBrush(state.cells, state.width, state.height, row, col, size, color));
}

export function eraseAt(
  state: EditorState,
  history: EditHistory,
  row: number,
  col: number,
  size: BrushSize,
): number {
  return commitSnapshots(state, history, 'eraser', applyErase(state.cells, state.width, state.height, row, col, size));
}

export function fillAt(
  state: EditorState,
  history: EditHistory,
  row: number,
  col: number,
  target: PaletteColor | null,
): number {
  return commitSnapshots(state, history, 'fill', floodFill(state.cells, state.width, state.height, row, col, target));
}

export function replaceCode(
  state: EditorState,
  history: EditHistory,
  fromCode: string,
  target: PaletteColor | null,
): number {
  return commitSnapshots(state, history, 'replace', replaceByCode(state.cells, fromCode, target));
}

export function clearPattern(state: EditorState, history: EditHistory): number {
  return commitSnapshots(state, history, 'clear', clearAll(state.cells));
}

export function undoEdit(state: EditorState, history: EditHistory): boolean {
  const entry = history.undo(state.cells);
  if (entry) refreshStats(state);
  return entry !== null;
}

export function redoEdit(state: EditorState, history: EditHistory): boolean {
  const entry = history.redo(state.cells);
  if (entry) refreshStats(state);
  return entry !== null;
}
