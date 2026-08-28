import { describe, expect, it } from 'vitest';
import { EditHistory, HISTORY_LIMIT, HISTORY_SNAPSHOT_LIMIT } from './history';
import { makeSolid, makeTransparent, type EditSnapshot } from './ops';
import type { PatternCell } from '@/lib/types';

function cellsOf(n: number): PatternCell[] {
  return Array.from({ length: n }, () => makeSolid('#FF0000', 'A'));
}

function snap(index: number, hex: string): EditSnapshot {
  return { index, before: cellsOf(1)[0], after: makeSolid(hex, 'A') };
}

describe('EditHistory（E21）', () => {
  it('空栈 undo/redo 返回 null', () => {
    const h = new EditHistory();
    const cells = cellsOf(4);
    expect(h.undo(cells)).toBeNull();
    expect(h.redo(cells)).toBeNull();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('push→undo→redo 往返恢复格值', () => {
    const h = new EditHistory();
    const cells = cellsOf(3);
    const before = cells[1];
    const after = makeSolid('#00FF00', 'B');
    h.push({ label: 'brush', snapshots: [{ index: 1, before, after }] });
    cells[1] = after;
    expect(h.undo(cells)?.label).toBe('brush');
    expect(cells[1]).toBe(before);
    expect(h.canRedo).toBe(true);
    h.redo(cells);
    expect(cells[1]).toBe(after);
    expect(h.canUndo).toBe(true);
  });

  it('新操作清空重做栈（redo 不可达）', () => {
    const h = new EditHistory();
    const cells = cellsOf(2);
    h.push({ label: 'brush', snapshots: [snap(0, '#00FF00')] });
    h.undo(cells);
    expect(h.canRedo).toBe(true);
    h.push({ label: 'eraser', snapshots: [snap(1, '#0000FF')] });
    expect(h.canRedo).toBe(false);
    expect(h.redo(cells)).toBeNull();
  });

  it('100 步上限丢最旧：第 101 步后最早一步不可撤销', () => {
    const h = new EditHistory();
    const cells = cellsOf(1);
    const hexOf = (i: number) => `#${(i + 1).toString(16).padStart(6, '0')}`;
    // 链式快照：第 i 步的 before = 第 i-1 步的 after（首步 before 为初始 #FF0000）
    for (let i = 0; i < HISTORY_LIMIT + 1; i++) {
      const before = i === 0 ? makeSolid('#FF0000', 'A') : makeSolid(hexOf(i - 1), 'A');
      h.push({ label: 'brush', snapshots: [{ index: 0, before, after: makeSolid(hexOf(i), 'A') }] });
    }
    cells[0] = makeSolid(hexOf(HISTORY_LIMIT), 'A');
    expect(h.depth).toBe(HISTORY_LIMIT);
    // 全部撤销 100 次后，第 1 笔（i=0）已被挤出：最终停留在第 2 笔的 before = hexOf(0)
    for (let i = 0; i < HISTORY_LIMIT; i++) h.undo(cells);
    expect(h.canUndo).toBe(false);
    expect(cells[0].hex).toBe(hexOf(0));
  });

  it('空快照条目不占栈', () => {
    const h = new EditHistory();
    h.push({ label: 'fill', snapshots: [] });
    expect(h.depth).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  describe('快照总量配额（A-02：200×200 图纸连续整图操作曾累积 400 万快照 / 578 MB）', () => {
    /** 整图级操作：一次 push 就是 W×H 个快照（旋转/清空/大面积油漆桶）。 */
    function pushWholePattern(h: EditHistory, size: number, hex: string): void {
      const snapshots: EditSnapshot[] = Array.from({ length: size }, (_, index) => ({
        index,
        before: makeSolid('#FF0000', 'A'),
        after: makeSolid(hex, 'A'),
      }));
      h.push({ label: 'transform', snapshots });
    }

    it('小图纸仍保留完整 100 步（配额不影响常规使用）', () => {
      const h = new EditHistory();
      for (let i = 0; i < HISTORY_LIMIT; i++) h.push({ label: 'brush', snapshots: [snap(0, '#00FF00')] });
      expect(h.depth).toBe(HISTORY_LIMIT);
      expect(h.snapshotCount).toBe(HISTORY_LIMIT);
    });

    it('大图纸整图操作按快照总量丢最旧，总量不超过配额', () => {
      const h = new EditHistory();
      const whole = 200 * 200; // 40 000
      for (let i = 0; i < 100; i++) pushWholePattern(h, whole, '#00FF00');
      expect(h.snapshotCount).toBeLessThanOrEqual(HISTORY_SNAPSHOT_LIMIT);
      // 配额 400 000 ÷ 每步 40 000 = 只能保留 10 步，而不是 100 步（旧行为会留 400 万个快照）
      expect(h.depth).toBe(Math.floor(HISTORY_SNAPSHOT_LIMIT / whole));
      expect(h.canUndo).toBe(true);
    });

    it('单步就超配额时仍保留该步，撤销永远可用', () => {
      const h = new EditHistory();
      pushWholePattern(h, HISTORY_SNAPSHOT_LIMIT + 1, '#00FF00');
      expect(h.depth).toBe(1);
      expect(h.canUndo).toBe(true);
    });

    it('撤销与重做在两栈间搬运时不重复计入配额', () => {
      const h = new EditHistory();
      const cells = cellsOf(4);
      h.push({ label: 'brush', snapshots: [snap(0, '#00FF00'), snap(1, '#00FF00')] });
      expect(h.snapshotCount).toBe(2);
      h.undo(cells);
      expect(h.snapshotCount).toBe(2);
      h.redo(cells);
      expect(h.snapshotCount).toBe(2);
      h.clear();
      expect(h.snapshotCount).toBe(0);
    });
  });

  it('clear 清空双栈', () => {
    const h = new EditHistory();
    const cells = cellsOf(1);
    h.push({ label: 'brush', snapshots: [snap(0, '#00FF00')] });
    h.undo(cells);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('撤销不产生历史条目（undo 后可再次 undo 前一步）', () => {
    const h = new EditHistory();
    const cells = cellsOf(1);
    h.push({ label: 'brush', snapshots: [snap(0, '#111111')] });
    h.push({ label: 'brush', snapshots: [snap(0, '#222222')] });
    expect(h.depth).toBe(2);
    h.undo(cells);
    expect(h.depth).toBe(1);
    h.undo(cells);
    expect(h.depth).toBe(0);
    expect(cells[0].hex).toBe('#FF0000');
  });

  it('makeTransparent 引用测试：undo 恢复原对象引用', () => {
    const h = new EditHistory();
    const cells = cellsOf(2);
    const original = cells[0];
    h.push({ label: 'clear', snapshots: [{ index: 0, before: original, after: makeTransparent() }] });
    cells[0] = makeTransparent();
    h.undo(cells);
    expect(cells[0]).toBe(original);
  });
});
