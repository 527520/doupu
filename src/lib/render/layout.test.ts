import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  MIN_LABEL_PX,
  ZOOM_MAX,
  ZOOM_MIN,
  boardSeamPositions,
  clampZoom,
  contrastColor,
  fitCellSize,
  labelVisible,
  pointToCell,
} from './layout';

describe('contrastColor', () => {
  it('深色底用白字、浅色底用黑字', () => {
    expect(contrastColor('#000000')).toBe('#FFFFFF');
    expect(contrastColor('#FFFFFF')).toBe('#000000');
    expect(contrastColor('#FFFF00')).toBe('#000000'); // 黄
    expect(contrastColor('#0000FF')).toBe('#FFFFFF'); // 蓝
    expect(contrastColor('#808080')).toBe('#FFFFFF'); // 中灰 128 < 150
    expect(contrastColor('#A0A0A0')).toBe('#000000'); // 160 > 150
  });

  it('非法 hex 回退黑字', () => {
    expect(contrastColor('bad')).toBe('#000000');
  });
});

describe('labelVisible', () => {
  it('12px 起标注，11px 不标注（边界）', () => {
    expect(labelVisible(12)).toBe(true);
    expect(labelVisible(11)).toBe(false);
    expect(labelVisible(MIN_LABEL_PX)).toBe(true);
  });
});

describe('fitCellSize', () => {
  it('等比适配容器（取最大整数）', () => {
    expect(fitCellSize(100, 100, 800, 800)).toBe(8);
    expect(fitCellSize(100, 50, 800, 800)).toBe(8); // 高受限 800/50=16，宽 800/100=8 → 8
    expect(fitCellSize(100, 50, 300, 300)).toBe(3);
    expect(fitCellSize(200, 200, 199, 199)).toBe(1); // 最小 1
  });

  it('非法输入回退 1', () => {
    expect(fitCellSize(0, 100, 800, 800)).toBe(1);
    expect(fitCellSize(100, 100, 0, 800)).toBe(1);
    expect(fitCellSize(-1, 100, 800, 800)).toBe(1);
  });
});

describe('boardSeamPositions', () => {
  it('每 29 格一条缝线（不含边界）', () => {
    expect(boardSeamPositions(10)).toEqual([]);
    expect(boardSeamPositions(28)).toEqual([]);
    expect(boardSeamPositions(29)).toEqual([]); // 29 格图纸恰好一板，无需内缝
    expect(boardSeamPositions(30)).toEqual([29]);
    expect(boardSeamPositions(58)).toEqual([29]);
    expect(boardSeamPositions(59)).toEqual([29, 58]);
    expect(boardSeamPositions(200)).toEqual([29, 58, 87, 116, 145, 174]);
    expect(BOARD_SIZE).toBe(29);
  });
});

describe('clampZoom', () => {
  it('钳制到 [50%, 1600%]；非法输入回退 1', () => {
    expect(clampZoom(0.5)).toBe(ZOOM_MIN);
    expect(clampZoom(16)).toBe(ZOOM_MAX);
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(20)).toBe(ZOOM_MAX);
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(ZOOM_MAX);
    expect(clampZoom(-Infinity)).toBe(ZOOM_MIN);
  });
});

describe('pointToCell', () => {
  it('画布坐标 → 格子坐标；越界返回 null', () => {
    expect(pointToCell(24, 12, 10, 0, 0, 100, 100)).toEqual({ row: 1, col: 2 });
    expect(pointToCell(-1, 0, 10, 0, 0, 100, 100)).toBeNull();
    expect(pointToCell(1000, 0, 10, 0, 0, 100, 100)).toBeNull();
    expect(pointToCell(5, 5, 10, 20, 20, 100, 100)).toBeNull(); // 偏移前
    expect(pointToCell(25, 25, 10, 20, 20, 100, 100)).toEqual({ row: 0, col: 0 });
  });
});
