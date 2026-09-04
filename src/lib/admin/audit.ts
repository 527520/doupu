import type { AnyDatabase } from '@/../db/client';
import { adminAuditLogs } from '@/../db/schema';
import type { UserRole } from '@/lib/auth/authorization';

const AUDIT_STATE_KEYS = new Set([
  'role',
  'accountStatus',
  'publicAuthorId',
  'statusChangedAt',
  'suspendedAt',
  'anonymizedAt',
  'revision',
  'revisionStatus',
  'lifecycleStatus',
  'featured',
  'commentsLocked',
  'reportStatus',
  'ruleSetVersion',
  'mergedIntoTagId',
  'status',
  'version',
  'ruleCount',
  'active',
  'sortOrder',
  'decision',
  'count',
]);

type AuditScalar = string | number | boolean | null;

export function sanitizeAuditState(input: unknown): Record<string, AuditScalar> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const output: Record<string, AuditScalar> = {};
  for (const [key, rawValue] of Object.entries(input)) {
    if (!AUDIT_STATE_KEYS.has(key)) continue;
    const value = rawValue instanceof Date ? rawValue.toISOString() : rawValue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      output[key] = value as AuditScalar;
    }
  }
  return output;
}

export interface AdminAuditInput {
  actorUserId: string | null;
  actorRole: UserRole;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  requestId: string;
  beforeState?: unknown;
  afterState?: unknown;
}

export async function writeAdminAudit(db: AnyDatabase, input: AdminAuditInput): Promise<string> {
  const [row] = await db.insert(adminAuditLogs).values({
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason.trim(),
    requestId: input.requestId,
    beforeState: sanitizeAuditState(input.beforeState),
    afterState: sanitizeAuditState(input.afterState),
  }).returning();
  return row.id;
}
