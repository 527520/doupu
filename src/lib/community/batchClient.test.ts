import { describe, expect, it } from 'vitest';
import { batchGenerationFailureMessage, officialBatchConcurrency, validateOfficialBatchFiles } from './batchClient';
import { zhCN } from '@/messages/zh-CN';

describe('official batch browser limits', () => {
  it('keeps only controlled image explanations, never internal Worker or browser messages', () => {
    expect(batchGenerationFailureMessage(new Error('palette is empty'))).toBe(zhCN.communityAdmin.batch.generationFailed);
    expect(batchGenerationFailureMessage(null)).toBe(zhCN.communityAdmin.batch.generationFailed);
    expect(batchGenerationFailureMessage(new Error(zhCN.errors.DECODE_FAILED))).toBe(zhCN.errors.DECODE_FAILED);
  });
  it('enforces 50 files, 20 MiB each and 200 MiB total', () => {
    const image = (size: number) => ({ size, type: 'image/png' }) as File;
    expect(validateOfficialBatchFiles([image(1)])).toBeNull();
    expect(validateOfficialBatchFiles([{ size: 1, type: '' }])).toBeNull();
    expect(validateOfficialBatchFiles([{ size: 1, type: 'application/octet-stream' }])).toBeNull();
    expect(validateOfficialBatchFiles([{ size: 1, type: 'text/plain' }])).toContain('图片');
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
