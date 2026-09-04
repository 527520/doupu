import { describe, expect, it } from 'vitest';
import { colorBucket, fileSizeBucket, widthBucket } from './buckets';

describe('analytics value buckets', () => {
  it('uses closed upper bounds without leaking exact values', () => {
    expect([24, 25, 50, 51, 100, 101, 150, 151].map(widthBucket)).toEqual([
      '1-24', '25-50', '25-50', '51-100', '51-100', '101-150', '101-150', '151-200',
    ]);
    expect([24, 25, 48, 49, 96, 97, 144, 145].map(colorBucket)).toEqual([
      '1-24', '25-48', '25-48', '49-72', '73-96', '97-144', '97-144', '145+',
    ]);
    expect(fileSizeBucket(1024 * 1024)).toBe('0-1m');
    expect(fileSizeBucket(20 * 1024 * 1024)).toBe('10-20m');
  });
});
