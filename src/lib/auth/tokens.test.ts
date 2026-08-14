import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from './tokens';

describe('tokens', () => {
  it('生成 43 字符的 base64url 令牌（32 字节）', () => {
    for (let i = 0; i < 10; i++) {
      const token = generateToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('每次生成的令牌唯一', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(seen.size).toBe(200);
  });

  it('哈希确定且为 64 位 hex，不含明文', () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashToken(token)); // 确定性
    expect(hash).not.toContain(token);
    expect(hash).not.toContain(token.slice(0, 10));
  });

  it('不同令牌哈希不同', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });
});
