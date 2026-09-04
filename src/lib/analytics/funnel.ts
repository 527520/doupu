export interface FunnelEvent {
  sessionId: string;
  name: string;
  occurredAt: Date;
  receivedAt?: Date;
  sequenceInBatch?: number;
}

export interface FunnelStepResult {
  name: string;
  sessions: number;
  conversionFromPrevious: number | null;
}

export const FUNNELS = {
  creation: [
    'page_viewed',
    'upload_selected',
    'crop_completed',
    'generation_succeeded',
    'design_saved',
    'design_exported',
  ],
  communityReuse: [
    'community_list_viewed',
    'community_detail_viewed',
    'community_reuse_succeeded',
    'design_saved',
    'design_exported',
  ],
  publication: [
    'community_submission_submitted',
    'community_reviewed',
    'community_published',
  ],
} as const;

export type FunnelId = keyof typeof FUNNELS;

export function computeOrderedFunnel(
  events: FunnelEvent[],
  steps: readonly string[],
): FunnelStepResult[] {
  const bySession = new Map<string, FunnelEvent[]>();
  for (const event of events) {
    const session = bySession.get(event.sessionId) ?? [];
    session.push(event);
    bySession.set(event.sessionId, session);
  }
  const counts = steps.map(() => 0);
  for (const session of bySession.values()) {
    session.sort((left, right) => (
      left.occurredAt.getTime() - right.occurredAt.getTime()
      || (left.receivedAt?.getTime() ?? 0) - (right.receivedAt?.getTime() ?? 0)
      || (left.sequenceInBatch ?? 0) - (right.sequenceInBatch ?? 0)
    ));
    let reached = -1;
    for (const event of session) {
      if (event.name === steps[reached + 1]) reached += 1;
      if (reached === steps.length - 1) break;
    }
    for (let index = 0; index <= reached; index++) counts[index] += 1;
  }
  return steps.map((name, index) => ({
    name,
    sessions: counts[index],
    conversionFromPrevious: index === 0
      ? (counts[index] > 0 ? 1 : null)
      : (counts[index - 1] > 0 ? counts[index] / counts[index - 1] : null),
  }));
}
