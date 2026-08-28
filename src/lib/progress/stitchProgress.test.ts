import { describe, expect, it } from 'vitest';
import {
  clearProgress,
  createStitchProgress,
  isProgressCompatible,
  parseStitchProgress,
  setRowDone,
  summarizeProgress,
  toggleCell,
} from './stitchProgress';
import type { PatternCell } from '@/lib/types';

const solid = (): PatternCell => ({ hex: '#FF0000', code: 'A', transparent: false });
const transparent = (): PatternCell => ({ hex: null, code: null, transparent: true });

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
