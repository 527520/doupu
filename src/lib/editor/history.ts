/**
 * 撤销/重做快照栈（E21）：上限 100 步且快照总量封顶，丢最旧；新操作清空重做栈。
 */
import type { EditSnapshot, ToolId } from './ops';

export const HISTORY_LIMIT = 100;

/**
 * 快照总量配额（A-02）。
 *
 * 只按「条目数」限流是不够的：旋转/清空/大面积油漆桶属于整图级操作，一步就是 W×H 个
 * 快照对象。200×200 图纸连按 100 次旋转会保留 400 万个快照（实测堆增长 578 MB），
 * 标签页崩溃时最近一次编辑往往还没落盘（自动保存 1 s 防抖）。
 *
 * 400 000 ≈ 单张满图（40 000 格）的 10 倍：小图纸仍能留满 100 步，
 * 大图纸自动把步数换成内存安全。
 */
export const HISTORY_SNAPSHOT_LIMIT = 400_000;

export interface HistoryEntry {
  label: ToolId;
  snapshots: EditSnapshot[];
  /** 变换类操作（旋转）的尺寸恢复信息：undo 用 before、redo 用 after。 */
  dims?: { before: { width: number; height: number }; after: { width: number; height: number } };
}

export class EditHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  /** 两栈快照总量；undo/redo 只在栈间搬运，不改变总量。 */
  private totalSnapshots = 0;

  /** 入栈（空快照忽略）；超出步数或快照配额则丢最旧；清空重做栈。 */
  push(entry: HistoryEntry): void {
    if (entry.snapshots.length === 0) return;
    this.totalSnapshots -= countSnapshots(this.redoStack);
    this.redoStack.length = 0;
    this.undoStack.push(entry);
    this.totalSnapshots += entry.snapshots.length;
    // 最新一步永远保留：即使它自己就超过配额，也不能让撤销变成不可用。
    while (
      this.undoStack.length > 1
      && (this.undoStack.length > HISTORY_LIMIT || this.totalSnapshots > HISTORY_SNAPSHOT_LIMIT)
    ) {
      const dropped = this.undoStack.shift();
      if (dropped) this.totalSnapshots -= dropped.snapshots.length;
    }
  }

  /** 撤销：应用 before 值到 cells；返回被撤销的条目（空栈返回 null）。 */
  undo(cells: import('@/lib/types').PatternCell[]): HistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    for (const s of entry.snapshots) cells[s.index] = s.before;
    this.redoStack.push(entry);
    return entry;
  }

  /** 重做：应用 after 值到 cells（空栈返回 null）。 */
  redo(cells: import('@/lib/types').PatternCell[]): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    for (const s of entry.snapshots) cells[s.index] = s.after;
    this.undoStack.push(entry);
    return entry;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.totalSnapshots = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get depth(): number {
    return this.undoStack.length;
  }

  /** 当前保留的快照总量（内存占用的直接代理指标）。 */
  get snapshotCount(): number {
    return this.totalSnapshots;
  }
}

function countSnapshots(entries: HistoryEntry[]): number {
  let total = 0;
  for (const entry of entries) total += entry.snapshots.length;
  return total;
}
