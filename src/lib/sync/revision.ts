export const DESIGN_PAGE_SIZE = 50;
export const TOMBSTONE_RETENTION_DAYS = 90;

export interface DesignCursor {
  updatedAt: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeDesignCursor(cursor: DesignCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeDesignCursor(encoded: string): DesignCursor | null {
  try {
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const value = JSON.parse(atob(padded)) as Partial<DesignCursor>;
    if (typeof value.updatedAt !== 'string' || typeof value.id !== 'string') return null;
    const date = new Date(value.updatedAt);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.updatedAt) return null;
    if (!UUID_RE.test(value.id)) return null;
    return { updatedAt: value.updatedAt, id: value.id };
  } catch {
    return null;
  }
}

export function measureJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function tombstoneCutoff(now = new Date()): Date {
  return new Date(now.getTime() - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function isTombstoneExpired(deletedAt: Date, now = new Date()): boolean {
  return deletedAt.getTime() <= tombstoneCutoff(now).getTime();
}
