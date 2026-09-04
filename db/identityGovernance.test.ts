import { beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, type TestDatabase } from './testClient';
import { emailTokens, adminAuditLogs, maintenanceRuns, users } from './schema';
import { createUnverifiedUser } from '@/lib/auth/transitions';
import { ensurePublicAuthorId } from '@/lib/identity/publicAuthorDb';

describe('identity governance schema', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestClient();
  });

  it('creates active users with the least privilege role and a non-enumerable public id', async () => {
    const result = await createUnverifiedUser(db, {
      email: 'new-user@example.com',
      passwordHash: 'hash',
      tokenHash: 'new-user-token',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [created] = await db.select().from(users);

    expect(result.id).toBe(created.id);
    expect(created.role).toBe('user');
    expect(created.accountStatus).toBe('active');
    expect(created.publicAuthorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await db.select().from(adminAuditLogs)).toEqual([]);
    expect(await db.select().from(maintenanceRuns)).toEqual([]);
    expect(await db.select().from(emailTokens)).toHaveLength(1);
  });

  it('lazily assigns one stable public author id to a pre-migration account', async () => {
    const [legacy] = await db.insert(users).values({
      email: 'legacy@example.com',
      passwordHash: 'hash',
      publicAuthorId: null,
    }).returning();

    const first = await ensurePublicAuthorId(db, legacy.id);
    const second = await ensurePublicAuthorId(db, legacy.id);

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });
});
