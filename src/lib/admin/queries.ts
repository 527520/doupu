import { and, desc, eq, gte, ilike, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDatabase } from '@/../db/client';
import { adminAuditLogs, maintenanceRuns, users } from '@/../db/schema';
import { APP_VERSION } from '@/lib/appInfo';
import { maskEmailForPublic } from '@/lib/identity/publicAuthor';
import migrationJournal from '@/../db/migrations/meta/_journal.json';
import { AppError } from '@/lib/errors';
import { sanitizeAuditState } from './audit';

export async function listGovernedUsers(db: AnyDatabase, search?: string) {
  const q = search?.trim().slice(0, 80);
  const rows = await db.select({
    id: users.id, email: users.email, username: users.username, role: users.role,
    accountStatus: users.accountStatus, governanceVersion: users.governanceVersion,
    emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt,
  }).from(users).where(q ? or(ilike(users.email, `%${q}%`), ilike(users.username, `%${q}%`), sql`${users.id}::text = ${q}`) : undefined)
    .orderBy(desc(users.createdAt)).limit(100);
  return rows.map((row) => ({
    userId: row.id,
    maskedEmail: row.email ? maskEmailForPublic(row.email) : null,
    username: row.username,
    role: row.role,
    accountStatus: row.accountStatus,
    governanceVersion: row.governanceVersion,
    emailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
  }));
}

const auditQuerySchema = z.object({
  q: z.string().trim().max(120).optional(), from: z.iso.date().optional(), to: z.iso.date().optional(),
  cursor: z.string().max(500).nullish(),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to);
const auditCursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() }).strict();

export async function listAdminAudit(db: AnyDatabase, input: unknown = {}) {
  const query = auditQuerySchema.parse(input);
  let cursor: z.infer<typeof auditCursorSchema> | null = null;
  if (query.cursor) {
    try { cursor = auditCursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))); }
    catch { throw new AppError('VALIDATION', '审计列表游标无效'); }
  }
  const rows = await db.select().from(adminAuditLogs).where(and(
    query.q ? or(ilike(adminAuditLogs.action, `%${query.q}%`), ilike(adminAuditLogs.targetId, `%${query.q}%`), ilike(adminAuditLogs.requestId, `%${query.q}%`)) : undefined,
    query.from ? gte(adminAuditLogs.createdAt, new Date(`${query.from}T00:00:00+08:00`)) : undefined,
    query.to ? lt(adminAuditLogs.createdAt, new Date(new Date(`${query.to}T00:00:00+08:00`).getTime() + 86400000)) : undefined,
    cursor ? or(lt(adminAuditLogs.createdAt, new Date(cursor.createdAt)), and(eq(adminAuditLogs.createdAt, new Date(cursor.createdAt)), lt(adminAuditLogs.id, cursor.id))) : undefined,
  )).orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id)).limit(51);
  const last = rows[49];
  return {
    items: rows.slice(0, 50).map((row) => ({ ...row, beforeState: sanitizeAuditState(row.beforeState), afterState: sanitizeAuditState(row.afterState), createdAt: row.createdAt.toISOString() })),
    nextCursor: rows.length > 50 && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null,
  };
}
export type AdminAuditEntry = Awaited<ReturnType<typeof listAdminAudit>>['items'][number];

export async function getSystemInfo(db: AnyDatabase) {
  const selection = {
    task: maintenanceRuns.task, status: maintenanceRuns.status, startedAt: maintenanceRuns.startedAt,
    completedAt: maintenanceRuns.completedAt, errorCode: maintenanceRuns.errorCode,
  };
  const [maintenance, latestByStatus] = await Promise.all([
    db.select(selection).from(maintenanceRuns).orderBy(desc(maintenanceRuns.startedAt), desc(maintenanceRuns.id)).limit(50),
    db.selectDistinctOn([maintenanceRuns.task, maintenanceRuns.status], selection).from(maintenanceRuns)
      .orderBy(maintenanceRuns.task, maintenanceRuns.status, desc(maintenanceRuns.startedAt), desc(maintenanceRuns.id)),
  ]);
  const serialize = (row: typeof maintenance[number]) => ({ ...row, startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null });
  const taskNames = [...new Set(['analytics.daily', ...latestByStatus.map((row) => row.task)])];
  const maintenanceTasks = taskNames.map((task) => {
    const runs = latestByStatus.filter((row) => row.task === task).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const success = runs.find((row) => row.status === 'succeeded');
    const failure = runs.find((row) => row.status === 'failed');
    return { task, latest: runs[0] ? serialize(runs[0]) : null, lastSuccess: success ? serialize(success) : null, lastFailure: failure ? serialize(failure) : null };
  });
  let databaseMigration: { id: number | null; appliedAt: string | null; journalTimestamp: string | null; status: 'recorded' | 'unavailable' } = { id: null, appliedAt: null, journalTimestamp: null, status: 'unavailable' };
  try {
    const result = await db.execute(sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc, id desc limit 1`);
    const row = (result as unknown as { rows?: Array<{ id: number; hash: string; created_at: number }> }).rows?.[0]
      ?? (result as unknown as Array<{ id: number; hash: string; created_at: number }>)[0];
    // Drizzle stores journalEntry.when, not wall-clock migration execution time.
    if (row) {
      const [evidence] = await db.select({ completedAt: maintenanceRuns.completedAt }).from(maintenanceRuns).where(and(
        eq(maintenanceRuns.task, 'database.migrate'), eq(maintenanceRuns.status, 'succeeded'), eq(maintenanceRuns.cursor, String(row.id)),
        sql`${maintenanceRuns.summary}->>'journalTimestamp' = ${String(row.created_at)}`, sql`${maintenanceRuns.summary}->>'hash' = ${row.hash}`,
      )).orderBy(desc(maintenanceRuns.completedAt), desc(maintenanceRuns.id)).limit(1);
      databaseMigration = { id: Number(row.id), appliedAt: evidence?.completedAt?.toISOString() ?? null, journalTimestamp: new Date(Number(row.created_at)).toISOString(), status: 'recorded' };
    }
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    if ((failure.code ?? failure.cause?.code) !== '42P01') throw error;
  }
  return {
    applicationVersion: APP_VERSION,
    migrationJournalLatest: migrationJournal.entries.at(-1)?.tag ?? null,
    databaseMigration,
    maintenance: maintenance.map(serialize), maintenanceTasks,
    backup: { status: 'not_integrated', label: '未接入' },
  };
}
