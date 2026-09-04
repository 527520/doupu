import { beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import {
  analyticsDailyRollups,
  analyticsDeletionRequests,
  analyticsEvents,
  analyticsVisitors,
  maintenanceRuns,
} from '@/../db/schema';
import { runAnalyticsMaintenance } from './maintenance';

const NOW = new Date('2026-09-05T04:00:00Z');

describe('analytics maintenance', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestClient();
  });

  it('rolls up completed Shanghai days, is reentrant, and enforces retention', async () => {
    const [visitor] = await db.insert(analyticsVisitors).values({ tokenHash: 'current', lastSeenAt: NOW }).returning();
    const base = {
      visitorId: visitor.id,
      userId: null,
      sessionId: crypto.randomUUID(),
      receivedAt: new Date('2026-09-03T01:00:01Z'),
      appVersion: 'test',
      actorType: 'anonymous',
      path: '/community',
      deviceType: 'mobile' as const,
      browserFamily: 'safari' as const,
      osFamily: 'ios' as const,
      properties: {},
      isInternal: false,
    };
    await db.insert(analyticsEvents).values([
      { ...base, eventId: crypto.randomUUID(), name: 'page_viewed', occurredAt: new Date('2026-09-03T01:00:00Z'), isBot: false },
      { ...base, eventId: crypto.randomUUID(), name: 'page_viewed', occurredAt: new Date('2026-09-03T01:01:00Z'), isBot: true },
      { ...base, eventId: crypto.randomUUID(), name: 'page_viewed', occurredAt: new Date('2026-01-01T01:00:00Z'), isBot: false },
    ]);
    await db.insert(analyticsDailyRollups).values({
      day: '2024-01-01', eventName: 'page_viewed', eventCount: 99, uniqueVisitors: 99,
    });
    const [withdrawnVisitor] = await db.insert(analyticsVisitors).values({ tokenHash: 'withdrawn' }).returning();
    await db.insert(analyticsDeletionRequests).values({ visitorTokenHash: 'withdrawn', status: 'pending' });
    await db.insert(analyticsEvents).values({
      ...base,
      visitorId: withdrawnVisitor.id,
      eventId: crypto.randomUUID(),
      name: 'page_viewed',
      occurredAt: new Date('2026-09-03T02:00:00Z'),
      isBot: false,
    });

    const first = await runAnalyticsMaintenance(db, NOW, { advisoryLock: false });
    expect(first).toMatchObject({
      skipped: false,
      daysRolledUp: 1,
      rawEventsDeleted: 1,
      rollupsDeleted: 1,
      deletionRequestsProcessed: 1,
    });
    const allRollups = await db.select().from(analyticsDailyRollups);
    expect(allRollups.find((row) => row.day === '2026-09-03' && row.dimensionName === 'all')).toMatchObject({
      eventCount: 1,
      uniqueVisitors: 1,
    });
    expect((await db.select().from(analyticsVisitors)).some((row) => row.id === withdrawnVisitor.id)).toBe(false);
    expect((await db.select().from(analyticsDeletionRequests))[0]).toMatchObject({
      status: 'succeeded',
      visitorTokenHash: null,
      deletedEventCount: 1,
    });

    await runAnalyticsMaintenance(db, NOW, { advisoryLock: false });
    const secondRollups = await db.select().from(analyticsDailyRollups);
    expect(secondRollups).toHaveLength(allRollups.length);
    expect(await db.select().from(maintenanceRuns)).toHaveLength(2);
    expect((await db.select().from(maintenanceRuns)).every((run) => run.status === 'succeeded')).toBe(true);
  });
});
