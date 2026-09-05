import { beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { analyticsDailyRollups, analyticsEvents, analyticsVisitors } from '@/../db/schema';
import { rollupAnalyticsDay } from './maintenance';
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
    await rollupAnalyticsDay(db, query.start, NOW);
    const later = new Date('2026-12-10T00:00:00Z');
    await expect(queryAnalyticsTrend(db, query, later)).resolves.toMatchObject({
      points: [{ day: query.start, events: 2, uniqueVisitors: 1 }],
    });
    await expect(queryAnalyticsTrend(db, { ...query, eventName: 'page_viewed' }, later)).resolves.toMatchObject({
      points: [{ day: query.start, events: 1, uniqueVisitors: 1 }],
    });
    await expect(queryAnalyticsDimensions(db, query, 'device', later)).resolves.toMatchObject({
      values: [{ value: 'mobile', events: 2, uniqueVisitors: null, dailyUniqueVisitorsSum: 1 }],
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
        { day: '2026-05-01', events: 10, uniqueVisitors: null },
        { day: '2026-05-02', events: 11, uniqueVisitors: null },
      ],
    });
    await expect(queryAnalyticsDimensions(db, query, 'device', NOW)).resolves.toMatchObject({
      values: [{ value: 'mobile', events: 13, uniqueVisitors: null, dailyUniqueVisitorsSum: null }],
    });
    await expect(queryAnalyticsFunnel(db, query, 'creation', NOW)).resolves.toMatchObject({
      unavailableReason: '仅最近 90 天原始事件支持同会话漏斗',
      steps: null,
    });
  });

  it('counts only community-origin saves and exports in the reuse funnel', async () => {
    const [visitor] = await db.insert(analyticsVisitors).values({ tokenHash: 'visitor-community' }).returning();
    const base = {
      visitorId: visitor.id, userId: null, receivedAt: new Date('2026-09-04T01:00:10Z'),
      appVersion: 'test', actorType: 'user', path: '/community', deviceType: 'desktop' as const,
      browserFamily: 'chrome' as const, osFamily: 'macos' as const, isBot: false, isInternal: false,
    };
    const events = (sessionId: string, source: 'cloud' | 'community') => [
      { name: 'community_list_viewed', properties: {} },
      { name: 'community_detail_viewed', properties: {} },
      { name: 'community_reuse_succeeded', properties: {} },
      { name: 'design_saved', properties: { source } },
      { name: 'design_exported', properties: { format: 'png', source: source === 'community' ? 'community' : 'other' } },
    ].map((event, index) => ({
      ...base, ...event, sessionId, eventId: crypto.randomUUID(), sequenceInBatch: index,
      occurredAt: new Date(`2026-09-04T01:00:0${index}Z`),
    }));
    await db.insert(analyticsEvents).values([
      ...events(crypto.randomUUID(), 'cloud'),
      ...events(crypto.randomUUID(), 'community'),
    ]);
    const funnel = await queryAnalyticsFunnel(db, { start: '2026-09-04', end: '2026-09-04' }, 'communityReuse', NOW);
    expect(funnel.steps?.map((step) => step.sessions)).toEqual([2, 2, 2, 1, 1]);
  });
});
