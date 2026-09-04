import { describe, expect, it } from 'vitest';
import { analyticsBatchSchema } from './events';

describe('analytics event catalog', () => {
  it('accepts only catalogued names and exact property shapes', () => {
    const valid = analyticsBatchSchema.safeParse({ events: [{
      eventId: '00000000-0000-4000-8000-000000000001',
      occurredAt: '2026-09-04T10:00:00.000Z',
      name: 'generation_succeeded',
      properties: { widthBucket: '51-100', colorBucket: '25-48' },
      path: '/app?private=query',
      referrer: 'https://example.com/path?q=secret',
      utm: { source: 'newsletter', medium: 'email', campaign: 'launch', content: 'hero' },
    }] });
    expect(valid.success).toBe(true);

    expect(analyticsBatchSchema.safeParse({ events: [{
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      name: 'arbitrary_event',
      properties: {},
    }] }).success).toBe(false);
    expect(analyticsBatchSchema.safeParse({ events: [{
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      name: 'generation_succeeded',
      properties: { widthBucket: '51-100', colorBucket: '25-48', privateText: 'no' },
    }] }).success).toBe(false);
    expect(analyticsBatchSchema.safeParse({ events: [{
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      name: 'design_exported',
      properties: { format: 'png' },
    }] }).success).toBe(false);
  });
});
