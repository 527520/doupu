const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function parseDay(day: string): number {
  if (!DAY_PATTERN.test(day)) throw new Error('INVALID_ANALYTICS_DAY');
  const timestamp = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day) {
    throw new Error('INVALID_ANALYTICS_DAY');
  }
  return timestamp;
}

export function toShanghaiDay(value: Date): string {
  return new Date(value.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function shanghaiDayBounds(day: string): { start: Date; end: Date } {
  const localMidnightAsUtc = parseDay(day);
  const start = new Date(localMidnightAsUtc - SHANGHAI_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export interface AnalyticsRangeCapability {
  mode: 'exact' | 'aggregate';
  start: Date;
  end: Date;
  rangeUvAvailable: boolean;
  funnelAvailable: boolean;
}

export function analyticsRangeCapability(
  startDay: string,
  endDay: string,
  now: Date = new Date(),
): AnalyticsRangeCapability {
  const { start } = shanghaiDayBounds(startDay);
  const { end } = shanghaiDayBounds(endDay);
  if (end <= start) throw new Error('INVALID_ANALYTICS_RANGE');

  const today = toShanghaiDay(now);
  const exactFloorTimestamp = parseDay(today) - (89 * DAY_MS);
  const exactFloor = new Date(exactFloorTimestamp - SHANGHAI_OFFSET_MS);
  const mode = start >= exactFloor ? 'exact' : 'aggregate';
  return {
    mode,
    start,
    end,
    rangeUvAvailable: mode === 'exact',
    funnelAvailable: mode === 'exact',
  };
}
