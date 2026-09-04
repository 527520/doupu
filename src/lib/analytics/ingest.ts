import { and, eq } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import {
  analyticsEvents,
  analyticsIdentityLinks,
  analyticsVisitors,
} from '@/../db/schema';
import type { Actor } from '@/lib/auth/authorization';
import { hashToken } from '@/lib/auth/tokens';
import { APP_VERSION } from '@/lib/appInfo';
import type { AnalyticsEnvelope } from './events';
import { isLikelyBot, normalizeAnalyticsContext } from './normalize';

const SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface AnalyticsRequestContext {
  userAgent: string | null;
  actor: Actor | null;
  isInternal?: boolean;
}

export async function ingestAnalyticsEvents(
  db: AnyDatabase,
  visitorToken: string,
  events: AnalyticsEnvelope[],
  context: AnalyticsRequestContext,
  now: Date = new Date(),
): Promise<number> {
  return db.transaction(async (tx) => {
    const [visitor] = await tx.select().from(analyticsVisitors)
      .where(eq(analyticsVisitors.tokenHash, hashToken(visitorToken)))
      .for('update');
    if (!visitor) return 0;

    const sessionExpired = now.getTime() - visitor.sessionLastSeenAt.getTime() >= SESSION_IDLE_MS;
    const sessionId = sessionExpired ? crypto.randomUUID() : visitor.currentSessionId;
    const [sessionEvent] = await tx.select({ id: analyticsEvents.id }).from(analyticsEvents)
      .where(and(
        eq(analyticsEvents.visitorId, visitor.id),
        eq(analyticsEvents.sessionId, sessionId),
        eq(analyticsEvents.name, 'session_started'),
      )).limit(1);
    const actorType = context.actor?.role ?? 'anonymous';
    const isBot = isLikelyBot(context.userAgent);
    const isInternal = context.isInternal === true;

    if (!sessionEvent) {
      const first = events[0];
      const normalized = normalizeAnalyticsContext({
        path: first?.path,
        referrer: first?.referrer,
        utm: first?.utm,
        userAgent: context.userAgent,
      });
      await tx.insert(analyticsEvents).values({
        eventId: crypto.randomUUID(),
        visitorId: visitor.id,
        userId: context.actor?.userId ?? null,
        sessionId,
        name: 'session_started',
        occurredAt: now,
        receivedAt: now,
        sequenceInBatch: -1,
        appVersion: APP_VERSION,
        actorType,
        ...normalized,
        properties: {},
        isBot,
        isInternal,
      });
    }

    let accepted = 0;
    for (const [sequenceInBatch, event] of events.entries()) {
      const occurredAt = new Date(event.occurredAt);
      if (
        occurredAt.getTime() < now.getTime() - MAX_EVENT_AGE_MS
        || occurredAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS
      ) continue;
      const normalized = normalizeAnalyticsContext({
        path: event.path,
        referrer: event.referrer,
        utm: event.utm,
        userAgent: context.userAgent,
      });
      const inserted = await tx.insert(analyticsEvents).values({
        eventId: event.eventId,
        visitorId: visitor.id,
        userId: context.actor?.userId ?? null,
        sessionId,
        name: event.name,
        occurredAt,
        receivedAt: now,
        sequenceInBatch,
        appVersion: APP_VERSION,
        actorType,
        ...normalized,
        properties: event.properties,
        isBot,
        isInternal,
      }).onConflictDoNothing({ target: analyticsEvents.eventId }).returning();
      accepted += inserted.length;
    }

    await tx.update(analyticsVisitors).set({
      currentSessionId: sessionId,
      sessionLastSeenAt: now,
      lastSeenAt: now,
    }).where(eq(analyticsVisitors.id, visitor.id));

    if (context.actor) {
      await tx.insert(analyticsIdentityLinks).values({
        visitorId: visitor.id,
        userId: context.actor.userId,
        linkedAt: now,
        lastSeenAt: now,
      }).onConflictDoUpdate({
        target: [analyticsIdentityLinks.visitorId, analyticsIdentityLinks.userId],
        set: { lastSeenAt: now },
      });
    }
    return accepted;
  });
}
