import { describe, expect, it } from 'vitest';
import { officialBatchConcurrency, validateOfficialBatchFiles } from './batchClient';

describe('official batch browser limits', () => {
  it('enforces 50 files, 20 MiB each and 200 MiB total', () => {
    const image = (size: number) => ({ size, type: 'image/png' }) as File;
    expect(validateOfficialBatchFiles([image(1)])).toBeNull();
    expect(validateOfficialBatchFiles(Array.from({ length: 51 }, () => image(1)))).toContain('1–50');
    expect(validateOfficialBatchFiles([image(21 * 1024 * 1024)])).toContain('20 MiB');
    expect(validateOfficialBatchFiles(Array.from({ length: 11 }, () => image(19 * 1024 * 1024)))).toContain('200 MiB');
  });

  it('uses one worker on lower concurrency devices and otherwise two', () => {
    expect(officialBatchConcurrency(4, 8)).toBe(1);
    expect(officialBatchConcurrency(8, 4)).toBe(1);
    expect(officialBatchConcurrency(8, 8)).toBe(2);
  });
});
