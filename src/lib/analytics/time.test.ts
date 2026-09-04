import { describe, expect, it } from 'vitest';
import { analyticsRangeCapability, shanghaiDayBounds, toShanghaiDay } from './time';

describe('analytics Shanghai time ranges', () => {
  it('uses Asia/Shanghai day boundaries and switches old ranges to aggregate mode', () => {
    expect(toShanghaiDay(new Date('2026-09-04T16:30:00.000Z'))).toBe('2026-09-05');
    expect(shanghaiDayBounds('2026-09-05')).toEqual({
      start: new Date('2026-09-04T16:00:00.000Z'),
      end: new Date('2026-09-05T16:00:00.000Z'),
    });
    expect(analyticsRangeCapability('2026-08-10', '2026-09-05', new Date('2026-09-05T04:00:00Z')).mode).toBe('exact');
    expect(analyticsRangeCapability('2026-05-01', '2026-09-05', new Date('2026-09-05T04:00:00Z'))).toMatchObject({
      mode: 'aggregate',
      rangeUvAvailable: false,
      funnelAvailable: false,
    });
  });
});
