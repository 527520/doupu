import { describe, expect, it } from 'vitest';
import { createTestClient } from './testClient';
import { adminAuditLogs, maintenanceRuns, users } from './schema';
import { getSystemInfo, listAdminAudit, listGovernedUsers } from '@/lib/admin/queries';

describe('admin query privacy and system evidence', () => {
  it('masks account email and reports unavailable backup truthfully', async () => {
    const db = await createTestClient();
    await db.insert(users).values({ email: 'private@example.com', passwordHash: 'secret', emailVerifiedAt: new Date() });
    const [user] = await listGovernedUsers(db);
    expect(user).toMatchObject({ maskedEmail: 'p***e@example.com', emailVerified: true });
    expect(user).not.toHaveProperty('email');
    expect(user).not.toHaveProperty('passwordHash');
    const info = await getSystemInfo(db);
    expect(info.backup).toEqual({ status: 'not_integrated', label: '未接入' });
    expect(info.migrationJournalLatest).toBe('0012_comment_publication_time');
    expect(info.databaseMigration.id).not.toBeNull();
    expect(info.databaseMigration.appliedAt).toBeNull();
    expect(info.databaseMigration.journalTimestamp).not.toBeNull();
  });

  it('paginates identical audit times without skips, filters and clips historical state', async () => {
    const db = await createTestClient();
    await db.insert(adminAuditLogs).values(Array.from({ length: 55 }, (_, index) => ({
      actorRole: 'admin' as const, action: 'community.approve', targetType: 'community_revision', targetId: `target-${index}`,
      reason: 'verified material', requestId: `request-${index}`, createdAt: new Date('2026-09-01T01:00:00Z'),
      beforeState: { status: 'pending_review', email: 'private@example.com', token: 'secret' }, afterState: { status: 'published' },
    })));
    const first = await listAdminAudit(db, {});
    expect(first.items).toHaveLength(50); expect(first.nextCursor).toBeTruthy();
    const second = await listAdminAudit(db, { cursor: first.nextCursor });
    expect(second.items).toHaveLength(5); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(55);
    expect(first.items[0].beforeState).toEqual({ status: 'pending_review' });
    expect((await listAdminAudit(db, { q: 'request-54', from: '2026-09-01', to: '2026-09-01' })).items).toHaveLength(1);
    expect((await listAdminAudit(db, { from: '2026-09-02' })).items).toHaveLength(0);
    await expect(listAdminAudit(db, { cursor: 'not-a-cursor' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(listAdminAudit(db, { from: '2026-09-03', to: '2026-09-01' })).rejects.toBeTruthy();
  });

  it('retains latest success and failure per task beyond the recent history window', async () => {
    const db = await createTestClient();
    await db.insert(maintenanceRuns).values([
      { task: 'analytics.daily', status: 'failed', startedAt: new Date('2026-08-01'), completedAt: new Date('2026-08-01T01:00:00Z'), errorCode: 'DATABASE_UNAVAILABLE' },
      ...Array.from({ length: 55 }, (_, index) => ({ task: 'analytics.daily', status: 'succeeded' as const, startedAt: new Date(Date.UTC(2026, 7, 2 + index)), completedAt: new Date(Date.UTC(2026, 7, 2 + index, 1)) })),
      { task: 'analytics.daily', status: 'running', startedAt: new Date('2026-10-01') },
    ]);
    const info = await getSystemInfo(db);
    expect(info.maintenance).toHaveLength(50);
    expect(info.maintenanceTasks).toEqual([expect.objectContaining({ task: 'analytics.daily', latest: expect.objectContaining({ status: 'running' }), lastSuccess: expect.objectContaining({ status: 'succeeded' }), lastFailure: expect.objectContaining({ errorCode: 'DATABASE_UNAVAILABLE' }) })]);
  });
});
