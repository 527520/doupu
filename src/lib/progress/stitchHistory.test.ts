import { describe, expect, it } from 'vitest';
import { createStitchProgress, toggleCell } from './stitchProgress';
import {
  canRedoStitchHistory,
  canUndoStitchHistory,
  commitStitchHistory,
  createStitchHistory,
  redoStitchHistory,
  undoStitchHistory,
} from './stitchHistory';

describe('StitchHistory', () => {
  it('提交后可撤销与重做，新的提交会清空重做分支', () => {
    const initial = createStitchProgress(2, 1, new Date('2026-01-01T00:00:00.000Z'));
    let history = createStitchHistory(initial);
    expect(canUndoStitchHistory(history)).toBe(false);
    expect(canRedoStitchHistory(history)).toBe(false);

    history = commitStitchHistory(history, toggleCell(history.current, 0, 0));
    history = commitStitchHistory(history, toggleCell(history.current, 0, 1));
    expect([...history.current.done]).toEqual([1, 1]);

    history = undoStitchHistory(history);
    expect([...history.current.done]).toEqual([1, 0]);
    expect(canRedoStitchHistory(history)).toBe(true);

    history = redoStitchHistory(history);
    expect([...history.current.done]).toEqual([1, 1]);

    history = undoStitchHistory(history);
    history = commitStitchHistory(history, toggleCell(history.current, 0, 0));
    expect([...history.current.done]).toEqual([0, 0]);
    expect(canRedoStitchHistory(history)).toBe(false);
  });

  it('默认只保留最近 100 步', () => {
    let history = createStitchHistory(createStitchProgress(1, 1));
    for (let index = 0; index < 101; index++) {
      history = commitStitchHistory(history, toggleCell(history.current, 0, 0));
    }
    expect(history.past).toHaveLength(100);

    for (let index = 0; index < 100; index++) history = undoStitchHistory(history);
    expect(canUndoStitchHistory(history)).toBe(false);
    // 最早一次提交已经被容量淘汰，撤销 100 次回到第 1 次提交后的状态。
    expect([...history.current.done]).toEqual([1]);
  });

  it('复制传入进度，外部修改 Uint8Array 不会污染历史快照', () => {
    const initial = createStitchProgress(1, 1);
    const history = createStitchHistory(initial);
    initial.done[0] = 1;
    expect([...history.current.done]).toEqual([0]);

    const next = toggleCell(history.current, 0, 0);
    const committed = commitStitchHistory(history, next);
    next.done[0] = 0;
    expect([...committed.current.done]).toEqual([1]);
  });
});
