/**
 * 密码哈希与校验（ADR-0004）：argon2id，memoryCost 65536 KiB、timeCost 3、parallelism 1
 * （OWASP 推荐档，单机低并发下足够快；升级不影响旧哈希的校验）。
 */
import argon2 from 'argon2';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/** 校验密码；任何异常（含格式错误的哈希）返回 false。 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
