import { describe, expect, it } from 'vitest';
import { computeOrderedFunnel } from './funnel';

describe('ordered session funnel', () => {
  it('counts only ordered steps reached inside the same session', () => {
    const result = computeOrderedFunnel([
      { sessionId: 'a', name: 'page_viewed', occurredAt: new Date('2026-09-05T00:00:00Z') },
      { sessionId: 'a', name: 'upload_selected', occurredAt: new Date('2026-09-05T00:01:00Z') },
      { sessionId: 'a', name: 'generation_succeeded', occurredAt: new Date('2026-09-05T00:02:00Z') },
      { sessionId: 'b', name: 'upload_selected', occurredAt: new Date('2026-09-05T00:00:00Z') },
      { sessionId: 'b', name: 'page_viewed', occurredAt: new Date('2026-09-05T00:01:00Z') },
      { sessionId: 'c', name: 'generation_succeeded', occurredAt: new Date('2026-09-05T00:02:00Z') },
    ], ['page_viewed', 'upload_selected', 'generation_succeeded']);

    expect(result.map((step) => step.sessions)).toEqual([2, 1, 1]);
    expect(result.map((step) => step.conversionFromPrevious)).toEqual([1, 0.5, 1]);
  });

  it('uses receive time and batch sequence to break identical client timestamps', () => {
    const occurredAt = new Date('2026-09-05T00:00:00Z');
    const receivedAt = new Date('2026-09-05T00:00:01Z');
    const result = computeOrderedFunnel([
      { sessionId: 'a', name: 'upload_selected', occurredAt, receivedAt, sequenceInBatch: 1 },
      { sessionId: 'a', name: 'page_viewed', occurredAt, receivedAt, sequenceInBatch: 0 },
    ], ['page_viewed', 'upload_selected']);
    expect(result.map((step) => step.sessions)).toEqual([1, 1]);
  });
});
