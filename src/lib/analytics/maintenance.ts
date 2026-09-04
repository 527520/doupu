import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  gte,
  isNotNull,
  lt,
  sql,
} from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import {
  analyticsDailyRollups,
  analyticsDeletionRequests,
  analyticsEvents,
  analyticsIdentityLinks,
  analyticsVisitors,
  maintenanceRuns,
} from '@/../db/schema';
import { shanghaiDayBounds, toShanghaiDay } from './time';

const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYTICS_MAINTENANCE_LOCK = 8_130_605_911;

const dimensions = [
  ['device', analyticsEvents.deviceType],
  ['browser', analyticsEvents.browserFamily],
  ['os', analyticsEvents.osFamily],
  ['actor', analyticsEvents.actorType],
  ['path', analyticsEvents.path],
  ['referrer', analyticsEvents.referrerDomain],
  ['utm_source', analyticsEvents.utmSource],
  ['utm_medium', analyticsEvents.utmMedium],
  ['utm_campaign', analyticsEvents.utmCampaign],
  ['utm_content', analyticsEvents.utmContent],
] as const;

export async function rollupAnalyticsDay(db: AnyDatabase, day: string, now = new Date()): Promise<number> {
  const { start, end } = shanghaiDayBounds(day);
  if (end > now) throw new Error('ANALYTICS_DAY_NOT_COMPLETE');
  return db.transaction(async (tx) => {
    const baseWhere = and(
      gte(analyticsEvents.occurredAt, start),
      lt(analyticsEvents.occurredAt, end),
      eq(analyticsEvents.isBot, false),
      eq(analyticsEvents.isInternal, false),
    );
    const totals = await tx.select({
      eventName: analyticsEvents.name,
      eventCount: count(),
      uniqueVisitors: countDistinct(analyticsEvents.visitorId),
    }).from(analyticsEvents).where(baseWhere).groupBy(analyticsEvents.name);
    const rows = totals.flatMap((row) => [
      { day, ...row, dimensionName: 'all', dimensionValue: 'all', updatedAt: now },
      { day, ...row, dimensionName: 'event', dimensionValue: row.eventName, updatedAt: now },
    ]);

    for (const [dimensionName, column] of dimensions) {
      const value = sql<string>`coalesce(${column}::text, '(none)')`;
      const values = await tx.select({
        eventName: analyticsEvents.name,
        dimensionValue: value,
        eventCount: count(),
        uniqueVisitors: countDistinct(analyticsEvents.visitorId),
      }).from(analyticsEvents).where(baseWhere).groupBy(analyticsEvents.name, value);
      rows.push(...values.map((row) => ({ day, ...row, dimensionName, updatedAt: now })));
    }

    await tx.delete(analyticsDailyRollups).where(eq(analyticsDailyRollups.day, day));
    for (let offset = 0; offset < rows.length; offset += 500) {
      await tx.insert(analyticsDailyRollups).values(rows.slice(offset, offset + 500));
    }
    return rows.length;
  });
}

async function processPendingDeletions(db: AnyDatabase, now: Date): Promise<number> {
  const requests = await db.select({
    id: analyticsDeletionRequests.id,
    visitorTokenHash: analyticsDeletionRequests.visitorTokenHash,
  }).from(analyticsDeletionRequests).where(and(
    eq(analyticsDeletionRequests.status, 'pending'),
    isNotNull(analyticsDeletionRequests.visitorTokenHash),
  )).orderBy(asc(analyticsDeletionRequests.requestedAt)).limit(100);
  let processed = 0;
  for (const request of requests) {
    await db.transaction(async (tx) => {
      const [visitor] = await tx.select({ id: analyticsVisitors.id }).from(analyticsVisitors)
        .where(eq(analyticsVisitors.tokenHash, request.visitorTokenHash!)).for('update');
      let deletedEventCount = 0;
      let deletedLinkCount = 0;
      if (visitor) {
        const [eventRow] = await tx.select({ value: count() }).from(analyticsEvents)
          .where(eq(analyticsEvents.visitorId, visitor.id));
        const [linkRow] = await tx.select({ value: count() }).from(analyticsIdentityLinks)
          .where(eq(analyticsIdentityLinks.visitorId, visitor.id));
        deletedEventCount = eventRow.value;
        deletedLinkCount = linkRow.value;
        await tx.delete(analyticsVisitors).where(eq(analyticsVisitors.id, visitor.id));
      }
      await tx.update(analyticsDeletionRequests).set({
        visitorTokenHash: null,
        status: 'succeeded',
        deletedEventCount,
        deletedLinkCount,
        completedAt: now,
      }).where(and(
        eq(analyticsDeletionRequests.id, request.id),
        eq(analyticsDeletionRequests.status, 'pending'),
      ));
    });
    processed += 1;
  }
  return processed;
}

function acquiredFromResult(result: unknown): boolean {
  const rows = Array.isArray(result)
    ? result
    : (result as { rows?: unknown[] } | null)?.rows;
  const first = rows?.[0] as { acquired?: boolean } | undefined;
  return first?.acquired === true;
}

export interface AnalyticsMaintenanceSummary {
  skipped: boolean;
  daysRolledUp: number;
  rollupRows: number;
  rawEventsDeleted: number;
  rollupsDeleted: number;
  visitorsDeleted: number;
  deletionRequestsProcessed: number;
}

export async function runAnalyticsMaintenance(
  db: AnyDatabase,
  now = new Date(),
  options: { advisoryLock?: boolean } = { advisoryLock: true },
): Promise<AnalyticsMaintenanceSummary> {
  const [run] = await db.insert(maintenanceRuns).values({ task: 'analytics.daily', startedAt: now }).returning();
  try {
    const result = await db.transaction(async (tx) => {
      if (options.advisoryLock !== false) {
        const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(${ANALYTICS_MAINTENANCE_LOCK}) as acquired`);
        if (!acquiredFromResult(lock)) {
          return {
            skipped: true,
            daysRolledUp: 0,
            rollupRows: 0,
            rawEventsDeleted: 0,
            rollupsDeleted: 0,
            visitorsDeleted: 0,
            deletionRequestsProcessed: 0,
          };
        }
      }

      const todayStart = shanghaiDayBounds(toShanghaiDay(now)).start;
      const rawCutoff = new Date(now.getTime() - 90 * DAY_MS);
      // Consent withdrawals must be applied before aggregation so their raw
      // events cannot be incorporated into a new de-identified rollup.
      const deletionRequestsProcessed = await processPendingDeletions(tx, now);
      const dayExpression = sql<string>`to_char(${analyticsEvents.occurredAt} at time zone 'Asia/Shanghai', 'YYYY-MM-DD')`;
      const days = await tx.select({ day: dayExpression }).from(analyticsEvents)
        .where(and(gte(analyticsEvents.occurredAt, rawCutoff), lt(analyticsEvents.occurredAt, todayStart)))
        .groupBy(dayExpression)
        .orderBy(asc(dayExpression));
      let rollupRows = 0;
      for (const item of days) rollupRows += await rollupAnalyticsDay(tx, item.day, now);

      const rawDeleted = await tx.delete(analyticsEvents).where(lt(analyticsEvents.occurredAt, rawCutoff)).returning();
      const oldestRollupDay = toShanghaiDay(new Date(now.getTime() - (2 * 365 * DAY_MS)));
      const rollupsDeleted = await tx.delete(analyticsDailyRollups)
        .where(lt(analyticsDailyRollups.day, oldestRollupDay)).returning();
      const visitorsDeleted = await tx.delete(analyticsVisitors)
        .where(lt(analyticsVisitors.lastSeenAt, new Date(now.getTime() - 180 * DAY_MS)))
        .returning();
      return {
        skipped: false,
        daysRolledUp: days.length,
        rollupRows,
        rawEventsDeleted: rawDeleted.length,
        rollupsDeleted: rollupsDeleted.length,
        visitorsDeleted: visitorsDeleted.length,
        deletionRequestsProcessed,
      };
    });
    await db.update(maintenanceRuns).set({
      status: 'succeeded',
      summary: result,
      completedAt: new Date(),
    }).where(eq(maintenanceRuns.id, run.id));
    return result;
  } catch (error) {
    await db.update(maintenanceRuns).set({
      status: 'failed',
      errorCode: 'ANALYTICS_MAINTENANCE_FAILED',
      completedAt: new Date(),
    }).where(eq(maintenanceRuns.id, run.id));
    throw error;
  }
}
