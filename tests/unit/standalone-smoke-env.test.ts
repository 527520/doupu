import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('CI standalone 冒烟容器环境变量', () => {
  it('docker run 带上生产 instrumentation 必填的原图桶和监听地址', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const start = workflow.indexOf('Standalone production startup');
    const end = workflow.indexOf('Verified backup and restore drill');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const smoke = workflow.slice(start, end);
    for (const key of ['COS_BUCKET', 'COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_REGION', 'HOSTNAME']) {
      expect(smoke, `missing ${key}`).toContain(key);
    }
  });
});
