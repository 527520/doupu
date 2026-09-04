import { beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { analyticsDailyRollups, analyticsEvents, analyticsVisitors } from '@/../db/schema';
import {
  queryAnalyticsDimensions,
  queryAnalyticsFunnel,
  queryAnalyticsSummary,
  queryAnalyticsTrend,
} from './reports';

const NOW = new Date('2026-09-05T04:00:00Z');

describe('analytics reports', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestClient();
  });

  it('provides exact UV, dimensions, and same-session funnel inside 90 days', async () => {
    const [visitor] = await db.insert(analyticsVisitors).values({ tokenHash: 'visitor-a' }).returning();
    const base = {
      visitorId: visitor.id,
      userId: null,
      sessionId: crypto.randomUUID(),
      receivedAt: new Date('2026-09-04T01:00:02Z'),
      appVersion: 'test',
      actorType: 'anonymous',
      path: '/app',
      deviceType: 'mobile' as const,
      browserFamily: 'safari' as const,
      osFamily: 'ios' as const,
      properties: {},
      isBot: false,
      isInternal: false,
    };
    await db.insert(analyticsEvents).values([
      { ...base, eventId: crypto.randomUUID(), name: 'page_viewed', occurredAt: new Date('2026-09-04T01:00:00Z'), sequenceInBatch: 0 },
      { ...base, eventId: crypto.randomUUID(), name: 'upload_selected', occurredAt: new Date('2026-09-04T01:00:01Z'), sequenceInBatch: 1 },
    ]);
    const query = { start: '2026-09-04', end: '2026-09-04' };
    await expect(queryAnalyticsSummary(db, query, NOW)).resolves.toMatchObject({
      capability: { mode: 'exact', rangeUvAvailable: true },
      totals: { events: 2, uniqueVisitors: 1, sessions: 1 },
    });
    await expect(queryAnalyticsDimensions(db, query, 'device', NOW)).resolves.toMatchObject({
      values: [{ value: 'mobile', events: 2, uniqueVisitors: 1 }],
    });
    const funnel = await queryAnalyticsFunnel(db, query, 'creation', NOW);
    expect(funnel.steps?.slice(0, 2)).toMatchObject([
      { name: 'page_viewed', sessions: 1 },
      { name: 'upload_selected', sessions: 1 },
    ]);
  });

  it('labels old ranges aggregate-only without inventing cross-day UV', async () => {
    await db.insert(analyticsDailyRollups).values([
      { day: '2026-05-01', eventName: 'page_viewed', eventCount: 10, uniqueVisitors: 7 },
      { day: '2026-05-02', eventName: 'page_viewed', eventCount: 11, uniqueVisitors: 8 },
      { day: '2026-05-01', eventName: 'page_viewed', dimensionName: 'device', dimensionValue: 'mobile', eventCount: 6, uniqueVisitors: 5 },
      { day: '2026-05-02', eventName: 'page_viewed', dimensionName: 'device', dimensionValue: 'mobile', eventCount: 7, uniqueVisitors: 6 },
    ]);
    const query = { start: '2026-05-01', end: '2026-05-02' };
    await expect(queryAnalyticsSummary(db, query, NOW)).resolves.toMatchObject({
      capability: { mode: 'aggregate', rangeUvAvailable: false, funnelAvailable: false },
      totals: { events: 21, uniqueVisitors: null, sessions: null },
    });
    await expect(queryAnalyticsTrend(db, query, NOW)).resolves.toMatchObject({
      points: [
        { day: '2026-05-01', events: 10, uniqueVisitors: 7 },
        { day: '2026-05-02', events: 11, uniqueVisitors: 8 },
      ],
    });
    await expect(queryAnalyticsDimensions(db, query, 'device', NOW)).resolves.toMatchObject({
      values: [{ value: 'mobile', events: 13, uniqueVisitors: null, dailyUniqueVisitorsSum: 11 }],
    });
    await expect(queryAnalyticsFunnel(db, query, 'creation', NOW)).resolves.toMatchObject({
      unavailableReason: '仅最近 90 天原始事件支持同会话漏斗',
      steps: null,
    });
  });
});
