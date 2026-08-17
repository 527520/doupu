import { describe, expect, it } from 'vitest';
import { createConcurrencyGate } from './concurrency';

describe('createConcurrencyGate', () => {
  it('never runs more than the configured number of jobs at once', async () => {
    const gate = createConcurrencyGate(2);
    let active = 0;
    let peak = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const jobs = Array.from({ length: 5 }, (_, value) => gate.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await blocked;
      active -= 1;
      return value;
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peak).toBe(2);
    release?.();
    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  it('releases a permit when a job rejects', async () => {
    const gate = createConcurrencyGate(1);
    await expect(gate.run(async () => { throw new Error('argon failure'); })).rejects.toThrow('argon failure');
    await expect(gate.run(async () => 'next')).resolves.toBe('next');
  });
});
