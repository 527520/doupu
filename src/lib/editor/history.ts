/** 撤销/重做快照栈（E21）：上限 100 步丢最旧；新操作清空重做栈。 */
import type { EditSnapshot, ToolId } from './ops';

export const HISTORY_LIMIT = 100;

export interface HistoryEntry {
  label: ToolId;
  snapshots: EditSnapshot[];
}

export class EditHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  /** 入栈（空快照忽略）；超出上限丢最旧；清空重做栈。 */
  push(entry: HistoryEntry): void {
    if (entry.snapshots.length === 0) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
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
}
