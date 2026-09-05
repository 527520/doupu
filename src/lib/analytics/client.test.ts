import { describe, expect, it, vi } from 'vitest';
import { createAnalyticsClient } from './client';

describe('analytics client queue', () => {
  it('does not queue before consent and flushes consented events in batches of ten', async () => {
    let consented = false;
    const send = vi.fn(async (_events: unknown[]) => true);
    const client = createAnalyticsClient({
      isConsented: () => consented,
      context: () => ({ path: '/app?secret=yes', referrer: 'https://ref.example/private?token=hidden' }),
      send,
      schedule: () => 1,
      cancelSchedule: () => undefined,
      now: () => new Date('2026-09-05T00:00:00.000Z'),
      randomId: () => crypto.randomUUID(),
    });

    client.track({ name: 'design_saved', properties: { source: 'local' } });
    await client.flush();
    expect(send).not.toHaveBeenCalled();

    consented = true;
    for (let index = 0; index < 10; index++) {
      client.track({ name: 'design_saved', properties: { source: 'local' } });
    }
    await client.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toHaveLength(10);
    expect(JSON.stringify(send.mock.calls[0][0])).not.toMatch(/secret|private|hidden/u);
    expect(send.mock.calls[0][0][0]).toMatchObject({ path: '/app', referrer: 'https://ref.example' });
  });

  it('does not retry a withdrawn batch after the user gives fresh consent', async () => {
    let resolve!: (accepted: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    const client = createAnalyticsClient({
      isConsented: () => true, context: () => ({}), send, schedule: () => 1,
      cancelSchedule: () => undefined, now: () => new Date(), randomId: () => crypto.randomUUID(),
    });
    client.track({ name: 'design_saved', properties: { source: 'local' } });
    const pending = client.flush();
    client.clear();
    resolve(false);
    await pending;
    await client.flush();
    expect(send).toHaveBeenCalledOnce();
  });
});
