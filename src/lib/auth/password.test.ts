import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password（argon2id）', () => {
  it('哈希不等于明文，且同密码两次哈希不同（随机盐）', async () => {
    const h1 = await hashPassword('correct horse battery');
    const h2 = await hashPassword('correct horse battery');
    expect(h1).not.toBe('correct horse battery');
    expect(h1).not.toContain('correct horse battery');
    expect(h1).not.toBe(h2);
  });

  it('正确密码 verify 为 true，错误密码为 false', async () => {
    const hash = await hashPassword('p@ssw0rd-测试');
    expect(await verifyPassword(hash, 'p@ssw0rd-测试')).toBe(true);
    expect(await verifyPassword(hash, 'p@ssw0rd-测视')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
    expect(await verifyPassword(hash, 'P@SSW0RD-测试')).toBe(false);
  });

  it('损坏的哈希字符串返回 false 而不抛异常', async () => {
    expect(await verifyPassword('not-a-valid-argon2-hash', 'anything')).toBe(false);
  });

  it('8 字符密码边界可用（策略校验在 schema 层，此处仅哈希往返）', async () => {
    const hash = await hashPassword('a'.repeat(8));
    expect(await verifyPassword(hash, 'a'.repeat(8))).toBe(true);
  });
});
