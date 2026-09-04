export const ANONYMIZED_DISPLAY_NAME = '已注销用户';

const EMAIL_SHAPED = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

export function isSafePublicUsername(username: string | null | undefined): boolean {
  const value = username?.trim() ?? '';
  return value.length > 0 && !EMAIL_SHAPED.test(value);
}

export function maskEmailForPublic(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@', 2);
  if (!local || !domain) return '豆友';
  if (local.length === 1) return `${local}***@${domain}`;
  return `${local[0]}***${local.at(-1)}@${domain}`;
}

export function resolvePublicDisplayName(
  username: string | null | undefined,
  email: string,
): string {
  return isSafePublicUsername(username) ? username!.trim() : maskEmailForPublic(email);
}
