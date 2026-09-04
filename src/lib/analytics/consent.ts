import { count, eq } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import {
  analyticsDeletionRequests,
  analyticsEvents,
  analyticsIdentityLinks,
  analyticsVisitors,
} from '@/../db/schema';
import { generateToken, hashToken } from '@/lib/auth/tokens';

export async function grantAnalyticsConsent(
  db: AnyDatabase,
  existingToken: string | null,
  now: Date = new Date(),
): Promise<string> {
  if (existingToken) {
    const [existing] = await db.select({ id: analyticsVisitors.id })
      .from(analyticsVisitors)
      .where(eq(analyticsVisitors.tokenHash, hashToken(existingToken)));
    if (existing) {
      await db.update(analyticsVisitors).set({ lastSeenAt: now }).where(eq(analyticsVisitors.id, existing.id));
      return existingToken;
    }
  }
  const token = generateToken();
  await db.insert(analyticsVisitors).values({
    tokenHash: hashToken(token),
    consentedAt: now,
    lastSeenAt: now,
    sessionLastSeenAt: now,
  });
  return token;
}

export async function eraseAnalyticsVisitor(
  db: AnyDatabase,
  token: string,
  now: Date = new Date(),
): Promise<{ events: number; links: number }> {
  const tokenHash = hashToken(token);
  return db.transaction(async (tx) => {
    const [request] = await tx.insert(analyticsDeletionRequests).values({
      visitorTokenHash: tokenHash,
      status: 'pending',
      requestedAt: now,
    }).returning();
    const [visitor] = await tx.select({ id: analyticsVisitors.id })
      .from(analyticsVisitors)
      .where(eq(analyticsVisitors.tokenHash, tokenHash))
      .for('update');
    let eventCount = 0;
    let linkCount = 0;
    if (visitor) {
      const [events] = await tx.select({ value: count() }).from(analyticsEvents)
        .where(eq(analyticsEvents.visitorId, visitor.id));
      const [links] = await tx.select({ value: count() }).from(analyticsIdentityLinks)
        .where(eq(analyticsIdentityLinks.visitorId, visitor.id));
      eventCount = events.value;
      linkCount = links.value;
      await tx.delete(analyticsVisitors).where(eq(analyticsVisitors.id, visitor.id));
    }
    await tx.update(analyticsDeletionRequests).set({
      visitorTokenHash: null,
      status: 'succeeded',
      deletedEventCount: eventCount,
      deletedLinkCount: linkCount,
      completedAt: now,
    }).where(eq(analyticsDeletionRequests.id, request.id));
    return { events: eventCount, links: linkCount };
  });
}
