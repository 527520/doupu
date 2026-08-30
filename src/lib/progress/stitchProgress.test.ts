import { describe, expect, it } from 'vitest';
import {
  clearProgress,
  createStitchProgress,
  findNextStitchTarget,
  getBoardRect,
  isBoardRowDone,
  isStitchableCell,
  isProgressCompatible,
  parseStitchProgress,
  setBoardRowDone,
  setRowDone,
  summarizeProgress,
  toggleCell,
} from './stitchProgress';
import type { PatternCell } from '@/lib/types';

const solid = (): PatternCell => ({ hex: '#FF0000', code: 'A', transparent: false });
const transparent = (): PatternCell => ({ hex: null, code: null, transparent: true });

describe('isStitchableCell', () => {
  it('只有具备颜色、非透明且非背景外部的格子需要跟拼', () => {
    expect(isStitchableCell(solid())).toBe(true);
    expect(isStitchableCell(transparent())).toBe(false);
    expect(isStitchableCell({ hex: null, transparent: false })).toBe(false);
    expect(isStitchableCell({ ...solid(), external: true })).toBe(false);
  });
});

describe('getBoardRect', () => {
  it('按 29×29 划分板块，并裁剪最右下方不足整板的范围', () => {
    expect(getBoardRect(60, 35, 0, 1)).toEqual({
      rowStart: 0,
      rowEndExclusive: 29,
      colStart: 29,
      colEndExclusive: 58,
      width: 29,
      height: 29,
    });
    expect(getBoardRect(60, 35, 1, 2)).toEqual({
      rowStart: 29,
      rowEndExclusive: 35,
      colStart: 58,
      colEndExclusive: 60,
      width: 2,
      height: 6,
    });
  });
});

describe('findNextStitchTarget', () => {
  it('按板块从左到右、从上到下查找，并跳过空板和板内空行', () => {
    const cells = Array.from({ length: 5 * 4 }, transparent);
    cells[1 * 5 + 3] = solid(); // 板 (0,1) 的局部第 1 行
    cells[0 * 5 + 4] = solid(); // 板 (0,2)，全局行更靠前但板块顺序更靠后
    cells[2 * 5] = solid(); // 板 (1,0)

    const progress = createStitchProgress(5, 4);
    expect(findNextStitchTarget(progress, cells, 2)).toEqual({
      boardRow: 0,
      boardCol: 1,
      localRow: 1,
      row: 1,
      col: 3,
    });
  });

  it('当前板目标完成后才推进到下一个板块，全部完成后返回 null', () => {
    const cells = Array.from({ length: 5 * 4 }, transparent);
    cells[1 * 5 + 3] = solid();
    cells[0 * 5 + 4] = solid();
    let progress = toggleCell(createStitchProgress(5, 4), 1, 3);

    expect(findNextStitchTarget(progress, cells, 2)).toEqual({
      boardRow: 0,
      boardCol: 2,
      localRow: 0,
      row: 0,
      col: 4,
    });

    progress = toggleCell(progress, 0, 4);
    expect(findNextStitchTarget(progress, cells, 2)).toBeNull();
  });
});

describe('setBoardRowDone', () => {
  it('只修改当前板块局部行中的可拼格，不跨到相邻板块或透明格', () => {
    const cells = Array.from({ length: 30 * 2 }, transparent);
    cells[30] = solid(); // 第 1 行，第 0 列
    cells[30 + 28] = solid(); // 当前板最后一列
    cells[30 + 29] = solid(); // 右侧相邻板
    const progress = createStitchProgress(30, 2);

    const next = setBoardRowDone(progress, cells, 0, 0, 1, true);

    expect(next).not.toBe(progress);
    expect(progress.done[30]).toBe(0);
    expect(next.done[30]).toBe(1);
    expect(next.done[30 + 28]).toBe(1);
    expect(next.done[30 + 29]).toBe(0);
    expect(next.done[30 + 1]).toBe(0);
  });
});

describe('isBoardRowDone', () => {
  it('当前板局部行至少有一个可拼格且全部已拼时才算完成', () => {
    const cells = Array.from({ length: 30 }, transparent);
    cells[0] = solid();
    cells[28] = solid();
    cells[29] = solid();
    let progress = createStitchProgress(30, 1);

    expect(isBoardRowDone(progress, cells, 0, 0, 0)).toBe(false);
    progress = setBoardRowDone(progress, cells, 0, 0, 0, true);
    expect(isBoardRowDone(progress, cells, 0, 0, 0)).toBe(true);
    expect(isBoardRowDone(progress, cells, 0, 1, 0)).toBe(false);
    expect(isBoardRowDone(createStitchProgress(2, 1), [transparent(), transparent()], 0, 0, 0)).toBe(false);
  });
});

describe('createStitchProgress / isProgressCompatible（G-1）', () => {
  it('新建进度全为未拼', () => {
    const progress = createStitchProgress(3, 2);
    expect(progress.done).toHaveLength(6);
    expect([...progress.done].every((value) => value === 0)).toBe(true);
  });

  it('尺寸不匹配的进度视为失效（图纸重新生成后不能把已拼标记错位）', () => {
    const progress = createStitchProgress(3, 2);
    expect(isProgressCompatible(progress, { width: 3, height: 2 })).toBe(true);
    expect(isProgressCompatible(progress, { width: 4, height: 2 })).toBe(false);
    expect(isProgressCompatible(progress, { width: 3, height: 3 })).toBe(false);
    expect(isProgressCompatible(null, { width: 3, height: 2 })).toBe(false);
  });
});

describe('parseStitchProgress（IndexedDB 往返）', () => {
  it('接受 Uint8Array 与 ArrayBuffer 两种形态', () => {
    const progress = createStitchProgress(2, 2);
    expect(parseStitchProgress(progress)?.done).toHaveLength(4);
    expect(parseStitchProgress({ ...progress, done: progress.done.buffer })?.done).toHaveLength(4);
  });

  it('版本不符、长度不符、非对象一律返回 null', () => {
    const progress = createStitchProgress(2, 2);
    expect(parseStitchProgress({ ...progress, version: 2 })).toBeNull();
    expect(parseStitchProgress({ ...progress, width: 3 })).toBeNull();
    expect(parseStitchProgress(null)).toBeNull();
    expect(parseStitchProgress('nope')).toBeNull();
  });
});

describe('toggleCell / setRowDone / clearProgress', () => {
  it('点一下标记已拼，再点取消；不原地修改原对象', () => {
    const progress = createStitchProgress(3, 2);
    const first = toggleCell(progress, 1, 2);
    expect(first).not.toBe(progress);
    expect(progress.done[5]).toBe(0);
    expect(first.done[5]).toBe(1);
    expect(toggleCell(first, 1, 2).done[5]).toBe(0);
  });

  it('越界坐标原样返回', () => {
    const progress = createStitchProgress(3, 2);
    expect(toggleCell(progress, 5, 0)).toBe(progress);
    expect(toggleCell(progress, 0, -1)).toBe(progress);
    expect(setRowDone(progress, 9, true)).toBe(progress);
  });

  it('整行标记与清空', () => {
    const progress = setRowDone(createStitchProgress(3, 2), 0, true);
    expect([...progress.done]).toEqual([1, 1, 1, 0, 0, 0]);
    expect([...setRowDone(progress, 0, false).done]).toEqual([0, 0, 0, 0, 0, 0]);
    expect([...clearProgress(progress).done].every((value) => value === 0)).toBe(true);
  });
});

describe('summarizeProgress', () => {
  const cells: PatternCell[] = [
    solid(), solid(), transparent(),
    solid(), transparent(), solid(),
  ];

  it('透明格不计入分母，否则带透明的图永远到不了 100%', () => {
    const progress = createStitchProgress(3, 2);
    expect(summarizeProgress(progress, cells).total).toBe(4);
  });

  it('与下一目标共用可拼格规则：无 hex 与 external 格均不计入', () => {
    const mixed: PatternCell[] = [
      solid(),
      { hex: null, code: null, transparent: false },
      { ...solid(), external: true },
    ];
    expect(summarizeProgress(createStitchProgress(3, 1), mixed)).toMatchObject({
      total: 1,
      doneCount: 0,
      nextRow: 0,
    });
  });

  it('百分比与下一未完成行', () => {
    let progress = createStitchProgress(3, 2);
    expect(summarizeProgress(progress, cells)).toMatchObject({ doneCount: 0, percent: 0, nextRow: 0 });

    progress = toggleCell(progress, 0, 0);
    progress = toggleCell(progress, 0, 1);
    // 第 0 行的两个实心格都完成 → 下一未完成行是第 1 行
    expect(summarizeProgress(progress, cells)).toMatchObject({ doneCount: 2, percent: 50, nextRow: 1 });

    progress = toggleCell(progress, 1, 0);
    progress = toggleCell(progress, 1, 2);
    expect(summarizeProgress(progress, cells)).toMatchObject({ doneCount: 4, percent: 100, nextRow: null });
  });

  it('把透明格标成已拼也不会让进度超过 100%', () => {
    const progress = toggleCell(createStitchProgress(3, 2), 0, 2); // 透明格
    expect(summarizeProgress(progress, cells)).toMatchObject({ doneCount: 0, percent: 0 });
  });

  it('全透明图纸的分母为 0 且不产生 NaN', () => {
    const empty = [transparent(), transparent()];
    expect(summarizeProgress(createStitchProgress(2, 1), empty)).toMatchObject({
      total: 0,
      percent: 0,
      nextRow: null,
    });
  });
});
