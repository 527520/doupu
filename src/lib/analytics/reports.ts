import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  gte,
  lt,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDatabase } from '@/../db/client';
import { analyticsDailyRollups, analyticsEvents } from '@/../db/schema';
import { AppError } from '@/lib/errors';
import { computeOrderedFunnel, FUNNELS, type FunnelId } from './funnel';
import { analyticsRangeCapability } from './time';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const analyticsDimensionSchema = z.enum([
  'event',
  'device',
  'browser',
  'os',
  'actor',
  'path',
  'referrer',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
]);
export type AnalyticsDimension = z.infer<typeof analyticsDimensionSchema>;

const filterSchema = z.object({
  eventName: z.string().trim().min(1).max(80).optional(),
  device: z.enum(['desktop', 'mobile', 'tablet', 'other']).optional(),
  browser: z.enum(['chrome', 'edge', 'firefox', 'safari', 'other']).optional(),
  os: z.enum(['android', 'ios', 'linux', 'macos', 'windows', 'other']).optional(),
  actor: z.enum(['anonymous', 'user', 'moderator', 'admin']).optional(),
  path: z.string().trim().min(1).max(200).regex(/^\//u).optional(),
  referrer: z.string().trim().min(1).max(253).optional(),
  utmSource: z.string().trim().min(1).max(100).optional(),
  utmMedium: z.string().trim().min(1).max(100).optional(),
  utmCampaign: z.string().trim().min(1).max(100).optional(),
  utmContent: z.string().trim().min(1).max(100).optional(),
}).strict();

export const analyticsQuerySchema = filterSchema.extend({
  start: day,
  end: day,
}).strict();
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

const rawDimensions = {
  event: analyticsEvents.name,
  device: analyticsEvents.deviceType,
  browser: analyticsEvents.browserFamily,
  os: analyticsEvents.osFamily,
  actor: analyticsEvents.actorType,
  path: analyticsEvents.path,
  referrer: analyticsEvents.referrerDomain,
  utmSource: analyticsEvents.utmSource,
  utmMedium: analyticsEvents.utmMedium,
  utmCampaign: analyticsEvents.utmCampaign,
  utmContent: analyticsEvents.utmContent,
} as const;

const rollupDimensionNames: Record<AnalyticsDimension, string> = {
  event: 'event',
  device: 'device',
  browser: 'browser',
  os: 'os',
  actor: 'actor',
  path: 'path',
  referrer: 'referrer',
  utmSource: 'utm_source',
  utmMedium: 'utm_medium',
  utmCampaign: 'utm_campaign',
  utmContent: 'utm_content',
};

function rawConditions(query: AnalyticsQuery, start: Date, end: Date): SQL[] {
  const conditions: SQL[] = [
    gte(analyticsEvents.occurredAt, start),
    lt(analyticsEvents.occurredAt, end),
    eq(analyticsEvents.isBot, false),
    eq(analyticsEvents.isInternal, false),
  ];
  if (query.eventName) conditions.push(eq(analyticsEvents.name, query.eventName));
  if (query.device) conditions.push(eq(analyticsEvents.deviceType, query.device));
  if (query.browser) conditions.push(eq(analyticsEvents.browserFamily, query.browser));
  if (query.os) conditions.push(eq(analyticsEvents.osFamily, query.os));
  if (query.actor) conditions.push(eq(analyticsEvents.actorType, query.actor));
  if (query.path) conditions.push(eq(analyticsEvents.path, query.path));
  if (query.referrer) conditions.push(eq(analyticsEvents.referrerDomain, query.referrer));
  if (query.utmSource) conditions.push(eq(analyticsEvents.utmSource, query.utmSource));
  if (query.utmMedium) conditions.push(eq(analyticsEvents.utmMedium, query.utmMedium));
  if (query.utmCampaign) conditions.push(eq(analyticsEvents.utmCampaign, query.utmCampaign));
  if (query.utmContent) conditions.push(eq(analyticsEvents.utmContent, query.utmContent));
  return conditions;
}

function assertSupportedRange(query: AnalyticsQuery, now: Date) {
  let capability;
  try {
    capability = analyticsRangeCapability(query.start, query.end, now);
  } catch {
    throw new AppError('VALIDATION', '分析日期范围无效');
  }
  const oldest = new Date(now);
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 2);
  if (capability.start < oldest || capability.end > new Date(now.getTime() + 36 * 60 * 60 * 1000)) {
    throw new AppError('VALIDATION', '分析日期范围仅支持最近两年');
  }
  return capability;
}

function hasCombinationFilter(query: AnalyticsQuery): boolean {
  return Object.entries(query).some(([key, value]) => (
    key !== 'start' && key !== 'end' && key !== 'eventName' && value !== undefined
  ));
}

function aggregateConditions(query: AnalyticsQuery): SQL[] {
  const conditions: SQL[] = [
    gte(analyticsDailyRollups.day, query.start),
    sql`${analyticsDailyRollups.day} <= ${query.end}`,
  ];
  if (query.eventName) conditions.push(eq(analyticsDailyRollups.eventName, query.eventName));
  return conditions;
}

export async function queryAnalyticsSummary(db: AnyDatabase, query: AnalyticsQuery, now = new Date()) {
  const capability = assertSupportedRange(query, now);
  if (capability.mode === 'exact') {
    const [row] = await db.select({
      events: count(),
      uniqueVisitors: countDistinct(analyticsEvents.visitorId),
      sessions: countDistinct(analyticsEvents.sessionId),
    }).from(analyticsEvents).where(and(...rawConditions(query, capability.start, capability.end)));
    return { capability, totals: { events: row.events, uniqueVisitors: row.uniqueVisitors, sessions: row.sessions } };
  }
  if (hasCombinationFilter(query)) {
    throw new AppError('VALIDATION', '超过 90 天的范围只支持总量与单维趋势');
  }
  const [row] = await db.select({ events: sum(analyticsDailyRollups.eventCount) })
    .from(analyticsDailyRollups)
    .where(and(
      ...aggregateConditions(query),
      eq(analyticsDailyRollups.dimensionName, 'all'),
      eq(analyticsDailyRollups.dimensionValue, 'all'),
    ));
  return {
    capability,
    totals: { events: Number(row.events ?? 0), uniqueVisitors: null, sessions: null },
  };
}

export async function queryAnalyticsTrend(db: AnyDatabase, query: AnalyticsQuery, now = new Date()) {
  const capability = assertSupportedRange(query, now);
  if (capability.mode === 'exact') {
    const dayExpression = sql<string>`to_char(${analyticsEvents.occurredAt} at time zone 'Asia/Shanghai', 'YYYY-MM-DD')`;
    const rows = await db.select({
      day: dayExpression,
      events: count(),
      uniqueVisitors: countDistinct(analyticsEvents.visitorId),
    }).from(analyticsEvents)
      .where(and(...rawConditions(query, capability.start, capability.end)))
      .groupBy(dayExpression)
      .orderBy(asc(dayExpression));
    return { capability, points: rows };
  }
  if (hasCombinationFilter(query)) {
    throw new AppError('VALIDATION', '超过 90 天的范围只支持总量与单维趋势');
  }
  const rows = await db.select({
    day: analyticsDailyRollups.day,
    events: sum(analyticsDailyRollups.eventCount),
    uniqueVisitors: sum(analyticsDailyRollups.uniqueVisitors),
  }).from(analyticsDailyRollups)
    .where(and(
      ...aggregateConditions(query),
      eq(analyticsDailyRollups.dimensionName, 'all'),
      eq(analyticsDailyRollups.dimensionValue, 'all'),
    ))
    .groupBy(analyticsDailyRollups.day)
    .orderBy(asc(analyticsDailyRollups.day));
  return {
    capability,
    points: rows.map((row) => ({
      day: row.day,
      events: Number(row.events ?? 0),
      uniqueVisitors: Number(row.uniqueVisitors ?? 0),
    })),
  };
}

export async function queryAnalyticsDimensions(
  db: AnyDatabase,
  query: AnalyticsQuery,
  dimension: AnalyticsDimension,
  now = new Date(),
) {
  const capability = assertSupportedRange(query, now);
  if (capability.mode === 'exact') {
    const column = rawDimensions[dimension];
    const rows = await db.select({
      value: column,
      events: count(),
      uniqueVisitors: countDistinct(analyticsEvents.visitorId),
    }).from(analyticsEvents)
      .where(and(...rawConditions(query, capability.start, capability.end)))
      .groupBy(column)
      .orderBy(asc(column));
    return { capability, dimension, values: rows.map((row) => ({ ...row, value: row.value ?? '(none)' })) };
  }
  if (hasCombinationFilter(query)) {
    throw new AppError('VALIDATION', '超过 90 天的范围只支持单维趋势');
  }
  const rows = await db.select({
    value: analyticsDailyRollups.dimensionValue,
    events: sum(analyticsDailyRollups.eventCount),
    uniqueVisitors: sum(analyticsDailyRollups.uniqueVisitors),
  }).from(analyticsDailyRollups)
    .where(and(
      ...aggregateConditions(query),
      eq(analyticsDailyRollups.dimensionName, rollupDimensionNames[dimension]),
    ))
    .groupBy(analyticsDailyRollups.dimensionValue)
    .orderBy(asc(analyticsDailyRollups.dimensionValue));
  return {
    capability,
    dimension,
    values: rows.map((row) => ({
      value: row.value,
      events: Number(row.events ?? 0),
      uniqueVisitors: null,
      dailyUniqueVisitorsSum: Number(row.uniqueVisitors ?? 0),
    })),
  };
}

export async function queryAnalyticsFunnel(
  db: AnyDatabase,
  query: AnalyticsQuery,
  funnel: FunnelId,
  now = new Date(),
) {
  const capability = assertSupportedRange(query, now);
  if (!capability.funnelAvailable) {
    return { capability, funnel, unavailableReason: '仅最近 90 天原始事件支持同会话漏斗', steps: null };
  }
  const rows = await db.select({
    sessionId: analyticsEvents.sessionId,
    name: analyticsEvents.name,
    occurredAt: analyticsEvents.occurredAt,
    receivedAt: analyticsEvents.receivedAt,
    sequenceInBatch: analyticsEvents.sequenceInBatch,
  }).from(analyticsEvents)
    .where(and(...rawConditions({ ...query, eventName: undefined }, capability.start, capability.end)))
    .orderBy(
      asc(analyticsEvents.sessionId),
      asc(analyticsEvents.occurredAt),
      asc(analyticsEvents.receivedAt),
      asc(analyticsEvents.sequenceInBatch),
    );
  return { capability, funnel, unavailableReason: null, steps: computeOrderedFunnel(rows, FUNNELS[funnel]) };
}

export const funnelIdSchema = z.enum(['creation', 'communityReuse', 'publication']);
