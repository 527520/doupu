import { describe, expect, it } from 'vitest';
import { createTestClient } from './testClient';
import { users } from './schema';
import { getSystemInfo, listGovernedUsers } from '@/lib/admin/queries';

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
  });
});
