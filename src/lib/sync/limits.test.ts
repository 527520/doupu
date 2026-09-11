import { describe, expect, it } from 'vitest';
import { exceedsProjectLimit } from './limits';

describe('exceedsProjectLimit', () => {
  it('循环引用无法序列化时视为超限', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(exceedsProjectLimit(cyclic)).toBe(true);
  });
});
