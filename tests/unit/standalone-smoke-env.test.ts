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

  it('token 哈希计算用 `--` 隔开位置参数，避免以「-」开头的 token 被 node 当选项', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const start = workflow.indexOf('Standalone production startup');
    const end = workflow.indexOf('Verified backup and restore drill');
    const smoke = workflow.slice(start, end);
    // base64url 随机 token 有 1/64 的概率以「-」开头；此时 node 会把位置参数
    // 解析成选项并以 `bad option` 退出 9，整步红灯（run #66 实证）。
    for (const name of ['SESSION_HASH', 'VERIFY_HASH', 'ADMIN_HASH']) {
      const line = smoke.split('\n').find((entry) => entry.includes(`${name}=`));
      expect(line, `missing ${name} command`).toBeTruthy();
      expect(line, `${name} must separate positional args with --`).toContain("\" -- \"$");
    }
    const spaced = smoke.split('\n').filter((entry) => entry.includes('node -e') && !entry.includes('randomBytes'));
    expect(spaced).toHaveLength(3);
    for (const line of spaced) expect(line).toContain(' -- ');
  });
});
