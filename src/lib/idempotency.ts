import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { idempotencyRecords } from '@/../db/schema';
import { AppError } from '@/lib/errors';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(',')}}`;
}

export function idempotencyRequestHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/**
 * Owns the key and the mutation result in one transaction. A concurrent
 * duplicate waits on the unique key, then replays the committed response.
 */
export async function executeIdempotently<T>(
  db: AnyDatabase,
  input: { actorUserId: string; scope: string; key: string; request: unknown; now?: Date },
  operation: (tx: AnyDatabase) => Promise<T>,
): Promise<{ value: T; replayed: boolean }> {
  const key = input.key.trim();
  if (!key || key.length > 100) throw new AppError('VALIDATION', '需要有效的 Idempotency-Key');
  const requestHash = idempotencyRequestHash(input.request);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(idempotencyRecords).values({
      actorUserId: input.actorUserId,
      scope: input.scope,
      key,
      requestHash,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    }).onConflictDoNothing().returning();

    const [record] = await tx.select().from(idempotencyRecords).where(and(
      eq(idempotencyRecords.actorUserId, input.actorUserId),
      eq(idempotencyRecords.scope, input.scope),
      eq(idempotencyRecords.key, key),
    )).for('update');
    if (!record) throw new AppError('INTERNAL', '幂等记录创建失败');
    if (record.requestHash !== requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', '相同幂等键不能用于不同请求');
    }
    if (inserted.length === 0) {
      if (record.response === null) throw new AppError('STATE_CONFLICT', '同一请求正在处理中');
      return { value: record.response as T, replayed: true };
    }
    const value = await operation(tx);
    await tx.update(idempotencyRecords).set({ response: value as object })
      .where(eq(idempotencyRecords.id, record.id));
    return { value, replayed: false };
  });
}
