'use client';

import { ANALYTICS_CONSENT_COOKIE } from './cookies';
import { normalizePath, normalizeReferrerDomain } from './normalize';
import {
  analyticsClientEventSchema,
  type AnalyticsClientEvent,
  type AnalyticsEnvelope,
} from './events';

interface ClientContext {
  path?: string;
  referrer?: string;
  utm?: AnalyticsEnvelope['utm'];
}

export interface AnalyticsClientOptions {
  isConsented: () => boolean;
  context: () => ClientContext;
  send: (events: AnalyticsEnvelope[]) => Promise<boolean>;
  beacon?: (events: AnalyticsEnvelope[]) => boolean;
  schedule: (callback: () => void, delayMs: number) => number;
  cancelSchedule: (id: number) => void;
  now: () => Date;
  randomId: () => string;
}

interface QueuedEvent {
  envelope: AnalyticsEnvelope;
  attempts: number;
}

export interface AnalyticsClient {
  track(event: AnalyticsClientEvent): void;
  flush(): Promise<void>;
  flushBeacon(): void;
  clear(): void;
}

export function createAnalyticsClient(options: AnalyticsClientOptions): AnalyticsClient {
  const queue: QueuedEvent[] = [];
  let timer: number | null = null;
  let sending: Promise<void> | null = null;
  let generation = 0;

  const cancelTimer = (): void => {
    if (timer !== null) options.cancelSchedule(timer);
    timer = null;
  };
  const scheduleFlush = (): void => {
    if (timer !== null || queue.length === 0) return;
    timer = options.schedule(() => {
      timer = null;
      void flush();
    }, 10_000);
  };
  const flush = async (): Promise<void> => {
    if (sending) return sending;
    if (!options.isConsented()) {
      queue.length = 0;
      cancelTimer();
      return;
    }
    const items = queue.splice(0, 10);
    if (items.length === 0) return;
    cancelTimer();
    const sentGeneration = generation;
    sending = (async () => {
      let accepted = false;
      try {
        accepted = await options.send(items.map((item) => item.envelope));
      } catch {
        accepted = false;
      }
      if (!accepted && sentGeneration === generation && options.isConsented()) {
        const retryable = items
          .filter((item) => item.attempts < 2)
          .map((item) => ({ ...item, attempts: item.attempts + 1 }));
        queue.unshift(...retryable);
      }
      sending = null;
      scheduleFlush();
    })();
    return sending;
  };

  return {
    track(event) {
      if (!options.isConsented()) return;
      const parsed = analyticsClientEventSchema.safeParse(event);
      if (!parsed.success) return;
      const context = options.context();
      const referrerDomain = normalizeReferrerDomain(context.referrer);
      queue.push({
        envelope: {
          ...parsed.data,
          eventId: options.randomId(),
          occurredAt: options.now().toISOString(),
          path: normalizePath(context.path),
          ...(referrerDomain ? { referrer: `https://${referrerDomain}` } : {}),
          ...(context.utm ? { utm: context.utm } : {}),
        },
        attempts: 0,
      });
      if (queue.length > 50) queue.splice(0, queue.length - 50);
      if (queue.length >= 10) void flush();
      else scheduleFlush();
    },
    flush,
    flushBeacon() {
      if (!options.isConsented() || !options.beacon) return;
      const items = queue.splice(0, 20);
      if (items.length === 0) return;
      cancelTimer();
      try {
        options.beacon(items.map((item) => item.envelope));
      } catch {
        // Analytics is best effort and never blocks navigation.
      }
    },
    clear() {
      generation++;
      queue.length = 0;
      cancelTimer();
    },
  };
}

let analyticsInitialized = false;

export function setAnalyticsInitialized(value: boolean): void { analyticsInitialized = value; }

function hasBrowserConsent(): boolean {
  return typeof document !== 'undefined'
    && typeof navigator !== 'undefined' && Boolean(navigator.locks?.request) && analyticsInitialized
    && document.cookie.split(';').some((part) => part.trim() === `${ANALYTICS_CONSENT_COOKIE}=granted`);
}

function browserContext(): ClientContext {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const utm: NonNullable<AnalyticsEnvelope['utm']> = {};
  const mappings = [
    ['utm_source', 'source'],
    ['utm_medium', 'medium'],
    ['utm_campaign', 'campaign'],
    ['utm_content', 'content'],
  ] as const;
  for (const [queryName, key] of mappings) {
    const value = params.get(queryName)?.slice(0, 100);
    if (value) utm[key] = value;
  }
  return {
    path: `${window.location.pathname}${window.location.search}`,
    referrer: document.referrer,
    ...(Object.keys(utm).length > 0 ? { utm } : {}),
  };
}

const browserClient = createAnalyticsClient({
  isConsented: hasBrowserConsent,
  context: browserContext,
  send: async (events) => {
    const response = await fetch('/api/analytics/events', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    return response.ok;
  },
  beacon: (events) => navigator.sendBeacon(
    '/api/analytics/events',
    new Blob([JSON.stringify({ events })], { type: 'application/json' }),
  ),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancelSchedule: (id) => window.clearTimeout(id),
  now: () => new Date(),
  randomId: () => crypto.randomUUID(),
});

export function track(event: AnalyticsClientEvent): void {
  try {
    browserClient.track(event);
  } catch {
    // Analytics failures must never affect the primary product flow.
  }
}

export function clearAnalyticsQueue(): void {
  browserClient.clear();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') browserClient.flushBeacon();
  });
}
