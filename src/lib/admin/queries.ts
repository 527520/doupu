import { desc, ilike, or, sql } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { adminAuditLogs, maintenanceRuns, users } from '@/../db/schema';
import { APP_VERSION } from '@/lib/appInfo';
import { maskEmailForPublic } from '@/lib/identity/publicAuthor';
import migrationJournal from '@/../db/migrations/meta/_journal.json';

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

export async function listAdminAudit(db: AnyDatabase) {
  const rows = await db.select().from(adminAuditLogs).orderBy(desc(adminAuditLogs.createdAt)).limit(200);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function getSystemInfo(db: AnyDatabase) {
  const maintenance = await db.select({
    task: maintenanceRuns.task, status: maintenanceRuns.status, startedAt: maintenanceRuns.startedAt,
    completedAt: maintenanceRuns.completedAt, errorCode: maintenanceRuns.errorCode,
  }).from(maintenanceRuns).orderBy(desc(maintenanceRuns.startedAt)).limit(50);
  let databaseMigration: { id: number | null; appliedAt: string | null } = { id: null, appliedAt: null };
  try {
    const result = await db.execute(sql`select id, created_at from drizzle.__drizzle_migrations order by id desc limit 1`);
    const row = (result as unknown as { rows?: Array<{ id: number; created_at: number }> }).rows?.[0]
      ?? (result as unknown as Array<{ id: number; created_at: number }>)[0];
    if (row) databaseMigration = { id: Number(row.id), appliedAt: new Date(Number(row.created_at)).toISOString() };
  } catch {
    databaseMigration = { id: null, appliedAt: null };
  }
  return {
    applicationVersion: APP_VERSION,
    migrationJournalLatest: migrationJournal.entries.at(-1)?.tag ?? null,
    databaseMigration,
    maintenance: maintenance.map((row) => ({ ...row, startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null })),
    backup: { status: 'not_integrated', label: '未接入' },
  };
}
