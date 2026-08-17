import { describe, expect, it } from 'vitest';
import { applyBrush, clearAll, floodFill, makeSolid } from './ops';
import type { PaletteColor, PatternCell } from '@/lib/types';

const RED: PaletteColor = { hex: '#FF0000', code: 'A' };
const BLUE: PaletteColor = { hex: '#0000FF', code: 'B' };
const W = 200;
const H = 200;

function solidGrid(color: PaletteColor = RED): PatternCell[] {
  return Array.from({ length: W * H }, () => makeSolid(color.hex, color.code));
}

function expectUnderBudget<T>(run: () => T, budgetMs = 200): T {
  const start = performance.now();
  const result = run();
  expect(performance.now() - start).toBeLessThan(budgetMs);
  return result;
}

describe('编辑器核心操作性能（无 coverage instrumentation）', () => {
  it('applyBrush：最大笔刷操作 <200ms', () => {
    const snapshots = expectUnderBudget(() => applyBrush(solidGrid(), W, H, 100, 100, 3, BLUE));
    expect(snapshots).toHaveLength(9);
  });

  it('floodFill：全连通 40000 格区域 <200ms', () => {
    const cells = solidGrid();
    const snapshots = expectUnderBudget(() => floodFill(cells, W, H, 0, 0, BLUE));
    expect(snapshots).toHaveLength(W * H);
    expect(cells.every((cell) => cell.hex === BLUE.hex)).toBe(true);
  });

  it('clearAll：200×200 全图清除 <200ms', () => {
    const snapshots = expectUnderBudget(() => clearAll(solidGrid()));
    expect(snapshots).toHaveLength(W * H);
  });
});
