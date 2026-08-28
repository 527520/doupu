import { describe, expect, it } from 'vitest';
import { MAX_PATTERN_ROWS, patternRows } from './generate';

describe('patternRows（A-05：行数与 200 行钳位）', () => {
  it('常规比例按比例计算，不钳位', () => {
    expect(patternRows(1000, 500, 100)).toEqual({
      rows: 50, exactRows: 50, clamped: false, maxWidthKeepingRatio: 100,
    });
  });

  it('手机竖屏截图 1080×2400 + 宽度 100：应 222 行，被钳到 200 并给出建议宽度', () => {
    const result = patternRows(1080, 2400, 100);
    expect(result.exactRows).toBe(222);
    expect(result.rows).toBe(MAX_PATTERN_ROWS);
    expect(result.clamped).toBe(true);
    expect(result.maxWidthKeepingRatio).toBe(90); // floor(200 × 1080 / 2400)
    // 建议宽度下不再钳位
    expect(patternRows(1080, 2400, result.maxWidthKeepingRatio).clamped).toBe(false);
  });

  it('长图 1000×3000：应 300 行，建议宽度 66', () => {
    const result = patternRows(1000, 3000, 100);
    expect(result.exactRows).toBe(300);
    expect(result.clamped).toBe(true);
    expect(result.maxWidthKeepingRatio).toBe(66);
  });

  it('极端比例至少 1 行；非法输入不抛异常', () => {
    expect(patternRows(4000, 1, 20).rows).toBe(1);
    expect(patternRows(0, 0, 100)).toEqual({ rows: 1, exactRows: 1, clamped: false, maxWidthKeepingRatio: 100 });
  });
});
