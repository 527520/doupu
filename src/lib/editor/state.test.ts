import { describe, expect, it } from 'vitest';
import {
  clearPattern,
  createEditorState,
  eraseAt,
  fillAt,
  paintBrush,
  redoEdit,
  replaceCode,
  undoEdit,
} from './state';
import { EditHistory } from './history';
import { makeSolid } from './ops';
import type { PaletteColor, Pattern } from '@/lib/types';

const RED: PaletteColor = { hex: '#FF0000', code: 'A' };
const BLUE: PaletteColor = { hex: '#0000FF', code: 'B' };

function patternOf(W: number, H: number): Pattern {
  return {
    width: W,
    height: H,
    cells: Array.from({ length: W * H }, () => makeSolid(RED.hex, RED.code)),
  };
}

describe('EditorState（E21/E23/E24 + 统计联动）', () => {
  it('创建时拷贝 cells（不修改原 pattern），统计初始正确', () => {
    const pattern = patternOf(2, 2);
    const state = createEditorState(pattern);
    expect(state.cells).not.toBe(pattern.cells);
    expect(state.stats).toEqual([{ code: 'A', hex: '#FF0000', count: 4 }]);
    expect(state.totalBeadCount).toBe(4);
    // 修改 state 不影响 pattern
    state.cells[0] = makeSolid(BLUE.hex, BLUE.code);
    expect(pattern.cells[0].hex).toBe(RED.hex);
  });

  it('E21：撤销/重做边界与栈行为', () => {
    const state = createEditorState(patternOf(3, 3));
    const history = new EditHistory();
    expect(undoEdit(state, history)).toBe(false); // 空栈
    expect(redoEdit(state, history)).toBe(false); // 空重做栈

    paintBrush(state, history, 0, 0, 1, BLUE);
    expect(state.cells[0].hex).toBe(BLUE.hex);
    expect(state.stats.find((s) => s.hex === BLUE.hex)?.count).toBe(1);
    expect(undoEdit(state, history)).toBe(true);
    expect(state.cells[0].hex).toBe(RED.hex);
    expect(state.stats.find((s) => s.hex === BLUE.hex)).toBeUndefined();
    expect(redoEdit(state, history)).toBe(true);
    expect(state.cells[0].hex).toBe(BLUE.hex);
  });

  it('E23：全局替换幂等、不存在色号提示零变更', () => {
    const state = createEditorState(patternOf(2, 2));
    const history = new EditHistory();
    expect(replaceCode(state, history, 'ZZZ', BLUE)).toBe(0);
    expect(replaceCode(state, history, 'A', BLUE)).toBe(4);
    expect(replaceCode(state, history, 'A', BLUE)).toBe(0); // 已无 A 色号
    expect(replaceCode(state, history, 'B', BLUE)).toBe(0); // 幂等
    expect(history.depth).toBe(1); // 只有一次真实替换入栈
  });

  it('E24：清除全部后统计为 0，且可整体撤销', () => {
    const state = createEditorState(patternOf(3, 3));
    const history = new EditHistory();
    expect(clearPattern(state, history)).toBe(9);
    expect(state.stats).toHaveLength(0);
    expect(state.totalBeadCount).toBe(0);
    expect(state.cells.every((c) => c.transparent)).toBe(true);
    expect(undoEdit(state, history)).toBe(true);
    expect(state.totalBeadCount).toBe(9);
    expect(state.stats).toEqual([{ code: 'A', hex: '#FF0000', count: 9 }]);
  });

  it('油漆桶与橡皮联动统计', () => {
    const state = createEditorState(patternOf(3, 3));
    const history = new EditHistory();
    fillAt(state, history, 1, 1, BLUE);
    expect(state.stats).toEqual([
      { code: 'B', hex: '#0000FF', count: 9 },
    ]);
    eraseAt(state, history, 0, 0, 2);
    expect(state.stats).toEqual([{ code: 'B', hex: '#0000FF', count: 5 }]);
    expect(state.totalBeadCount).toBe(5);
  });

  it('混合操作后统计按数量降序', () => {
    const state = createEditorState(patternOf(4, 1));
    const history = new EditHistory();
    paintBrush(state, history, 0, 0, 1, BLUE);
    paintBrush(state, history, 0, 1, 1, BLUE);
    paintBrush(state, history, 0, 2, 1, BLUE);
    expect(state.stats).toEqual([
      { code: 'B', hex: '#0000FF', count: 3 },
      { code: 'A', hex: '#FF0000', count: 1 },
    ]);
  });

  it('性能探针：200×200 单操作 <50ms', () => {
    const state = createEditorState(patternOf(200, 200));
    const history = new EditHistory();
    const probe = (fn: () => unknown): number => {
      const start = performance.now();
      fn();
      return performance.now() - start;
    };
    expect(probe(() => paintBrush(state, history, 100, 100, 3, BLUE))).toBeLessThan(50);
    expect(probe(() => fillAt(state, history, 0, 0, RED))).toBeLessThan(50);
    expect(probe(() => replaceCode(state, history, 'B', null))).toBeLessThan(50);
    expect(probe(() => clearPattern(state, history))).toBeLessThan(50);
    expect(probe(() => undoEdit(state, history))).toBeLessThan(50);
  });
});
