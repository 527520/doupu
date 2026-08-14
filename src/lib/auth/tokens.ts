/**
 * 随机令牌生成与哈希（ADR-0004）：
 * 会话/邮件令牌均为 32 字节随机数（base64url 下发），库中只存 SHA-256 哈希。
 */
import { createHash, randomBytes } from 'node:crypto';

/** 32 字节随机令牌，base64url 编码（URL 安全，可用于邮件链接）。 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 令牌哈希（sha256 hex），库中仅存此值。 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
