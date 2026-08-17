import { describe, expect, it } from 'vitest';
import {
  decodeDesignCursor,
  encodeDesignCursor,
  isTombstoneExpired,
  measureJsonBytes,
} from './revision';

describe('revision sync primitives', () => {
  it('cursor round-trips timestamp and id without locale-dependent parsing', () => {
    const value = { updatedAt: '2026-08-17T08:09:10.123Z', id: '00000000-0000-4000-8000-000000000123' };
    expect(decodeDesignCursor(encodeDesignCursor(value))).toEqual(value);
  });

  it('rejects malformed and non-canonical cursors', () => {
    expect(decodeDesignCursor('not-base64')).toBeNull();
    expect(decodeDesignCursor(Buffer.from(JSON.stringify({ updatedAt: 'yesterday', id: 'x' })).toString('base64url'))).toBeNull();
  });

  it('measures UTF-8 JSON bytes rather than UTF-16 code units', () => {
    expect(measureJsonBytes({ value: '豆' })).toBe(new TextEncoder().encode('{"value":"豆"}').length);
  });

  it('expires tombstones at 90 days exactly', () => {
    const now = new Date('2026-08-17T00:00:00.000Z');
    expect(isTombstoneExpired(new Date('2026-05-19T00:00:00.000Z'), now)).toBe(true);
    expect(isTombstoneExpired(new Date('2026-05-19T00:00:00.001Z'), now)).toBe(false);
  });
});
