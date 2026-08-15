import { describe, expect, it } from 'vitest';
import { sanitizeClientTimestamp } from './engine';

describe('sanitizeClientTimestamp（客户端时钟偏差防护）', () => {
  it('无服务器时间时原样返回', () => {
    expect(sanitizeClientTimestamp('2026-08-15T00:00:00.000Z', null)).toBe('2026-08-15T00:00:00.000Z');
  });

  it('客户端时钟落后：钳制为 maxServer + 1ms', () => {
    expect(sanitizeClientTimestamp('2026-08-15T00:00:00.000Z', '2026-08-15T01:00:00.000Z')).toBe(
      '2026-08-15T01:00:00.001Z',
    );
  });

  it('客户端时钟领先：原样保留', () => {
    expect(sanitizeClientTimestamp('2026-08-15T02:00:00.000Z', '2026-08-15T01:00:00.000Z')).toBe(
      '2026-08-15T02:00:00.000Z',
    );
  });

  it('相等时钳制（保证严格较新）', () => {
    expect(sanitizeClientTimestamp('2026-08-15T01:00:00.000Z', '2026-08-15T01:00:00.000Z')).toBe(
      '2026-08-15T01:00:00.001Z',
    );
  });

  it('非法时间戳原样返回', () => {
    expect(sanitizeClientTimestamp('not-a-date', '2026-08-15T01:00:00.000Z')).toBe('not-a-date');
    expect(sanitizeClientTimestamp('2026-08-15T01:00:00.000Z', 'bad')).toBe('2026-08-15T01:00:00.000Z');
  });
});
