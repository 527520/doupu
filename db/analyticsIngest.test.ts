import { beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, type TestDatabase } from './testClient';
import { analyticsEvents, analyticsIdentityLinks, analyticsVisitors, users } from './schema';
import { ingestAnalyticsEvents } from '@/lib/analytics/ingest';
import { hashToken } from '@/lib/auth/tokens';

describe('analytics ingestion sessions', () => {
  let db: TestDatabase;
  const token = 'a'.repeat(43);

  beforeEach(async () => {
    db = await createTestClient();
    await db.insert(analyticsVisitors).values({
      tokenHash: hashToken(token),
      currentSessionId: '00000000-0000-4000-8000-000000000010',
      sessionLastSeenAt: new Date('2026-09-05T00:00:00.000Z'),
      consentedAt: new Date('2026-09-05T00:00:00.000Z'),
      lastSeenAt: new Date('2026-09-05T00:00:00.000Z'),
    });
  });

  it('starts a new ordered session after thirty idle minutes and links a signed-in actor', async () => {
    await ingestAnalyticsEvents(db, token, [{
      eventId: '00000000-0000-4000-8000-000000000011',
      occurredAt: '2026-09-05T00:01:00.000Z',
      name: 'community_list_viewed',
      properties: { sort: 'latest' },
      path: '/community',
    }], { userAgent: null, actor: null }, new Date('2026-09-05T00:01:00.000Z'));

    const [user] = await db.insert(users).values({
      email: 'linked@example.com', passwordHash: 'hash', emailVerifiedAt: new Date(),
    }).returning();
    await ingestAnalyticsEvents(db, token, [{
      eventId: '00000000-0000-4000-8000-000000000012',
      occurredAt: '2026-09-05T00:31:00.000Z',
      name: 'community_detail_viewed',
      properties: {},
      path: '/community/work',
    }], { userAgent: null, actor: {
      userId: user.id, role: 'user', accountStatus: 'active', emailVerified: true,
    } }, new Date('2026-09-05T00:31:00.000Z'));

    const events = await db.select().from(analyticsEvents);
    expect(new Set(events.map((event) => event.sessionId)).size).toBe(2);
    expect(events.filter((event) => event.name === 'session_started')).toHaveLength(2);
    expect(await db.select().from(analyticsIdentityLinks)).toHaveLength(1);
  });
});
