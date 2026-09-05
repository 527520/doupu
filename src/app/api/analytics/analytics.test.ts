import { beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { analyticsDeletionRequests, analyticsEvents, analyticsVisitors } from '@/../db/schema';
import { setTestDb } from '@/lib/auth/db';
import { ANALYTICS_CONSENT_COOKIE, ANALYTICS_VISITOR_COOKIE } from '@/lib/analytics/cookies';
import { PUT as consentPut } from './consent/route';
import { POST as eventsPost } from './events/route';

const ORIGIN = 'http://localhost:3000';

function consentRequest(status: 'granted' | 'denied' | 'withdrawn', cookie?: string): Request {
  return new Request(`${ORIGIN}/api/analytics/consent`, {
    method: 'PUT',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ status }),
  });
}

describe('analytics consent API', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestClient();
    setTestDb(db);
  });

  it('creates a visitor only after consent and erases its raw identity on withdrawal', async () => {
    const granted = await consentPut(consentRequest('granted'));
    expect(granted.status).toBe(200);
    const setCookie = granted.headers.get('set-cookie') ?? '';
    // 服务器的旧 grant 响应不能覆盖浏览器后来写入的撤回意图。
    expect(setCookie).not.toContain(`${ANALYTICS_CONSENT_COOKIE}=granted`);
    const visitorToken = new RegExp(`${ANALYTICS_VISITOR_COOKIE}=([A-Za-z0-9_-]{43})`).exec(setCookie)?.[1];
    expect(visitorToken).toBeTruthy();
    expect(await db.select().from(analyticsVisitors)).toHaveLength(1);

    const withdrawn = await consentPut(consentRequest(
      'withdrawn',
      `${ANALYTICS_CONSENT_COOKIE}=granted; ${ANALYTICS_VISITOR_COOKIE}=${visitorToken}`,
    ));
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.headers.get('set-cookie')).toContain(`${ANALYTICS_CONSENT_COOKIE}=denied`);
    expect(await db.select().from(analyticsVisitors)).toEqual([]);
    const [deletion] = await db.select().from(analyticsDeletionRequests);
    expect(deletion).toMatchObject({ status: 'succeeded', visitorTokenHash: null });
  });

  it('deduplicates strict events and persists only normalized request context', async () => {
    const granted = await consentPut(consentRequest('granted'));
    const setCookie = granted.headers.get('set-cookie') ?? '';
    const visitorToken = new RegExp(`${ANALYTICS_VISITOR_COOKIE}=([A-Za-z0-9_-]{43})`).exec(setCookie)?.[1];
    const eventId = crypto.randomUUID();
    const body = JSON.stringify({ events: [{
      eventId,
      occurredAt: new Date().toISOString(),
      name: 'generation_succeeded',
      properties: { widthBucket: '51-100', colorBucket: '25-48' },
      path: '/app?private=query',
      referrer: 'https://example.com/private/path?q=secret',
      utm: { source: 'News', medium: 'Email', campaign: 'launch', content: 'hero' },
    }] });
    const request = () => new Request(`${ORIGIN}/api/analytics/events`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        cookie: `${ANALYTICS_CONSENT_COOKIE}=granted; ${ANALYTICS_VISITOR_COOKIE}=${visitorToken}`,
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
        'x-real-ip': '203.0.113.9',
      },
      body,
    });

    expect((await eventsPost(request())).status).toBe(202);
    expect((await eventsPost(request())).status).toBe(202);

    const rows = await db.select().from(analyticsEvents);
    expect(rows).toHaveLength(2);
    const event = rows.find((row) => row.eventId === eventId)!;
    expect(event).toMatchObject({
      path: '/app',
      referrerDomain: 'example.com',
      utmSource: 'news',
      utmMedium: 'email',
      deviceType: 'mobile',
      browserFamily: 'safari',
      osFamily: 'ios',
      actorType: 'anonymous',
    });
    expect(JSON.stringify(rows)).not.toContain('private=query');
    expect(JSON.stringify(rows)).not.toContain('Mozilla');
    expect(rows.filter((row) => row.name === 'session_started')).toHaveLength(1);
  });

  it('rejects unknown events and oversized batches with stable errors', async () => {
    const granted = await consentPut(consentRequest('granted'));
    const setCookie = granted.headers.get('set-cookie') ?? '';
    const visitorToken = new RegExp(`${ANALYTICS_VISITOR_COOKIE}=([A-Za-z0-9_-]{43})`).exec(setCookie)?.[1];
    const headers = {
      origin: ORIGIN,
      'content-type': 'application/json',
      cookie: `${ANALYTICS_CONSENT_COOKIE}=granted; ${ANALYTICS_VISITOR_COOKIE}=${visitorToken}`,
    };
    const unknown = await eventsPost(new Request(`${ORIGIN}/api/analytics/events`, {
      method: 'POST', headers, body: JSON.stringify({ events: [{
        eventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), name: 'unknown', properties: {},
      }] }),
    }));
    expect(unknown.status).toBe(400);

    const oversized = await eventsPost(new Request(`${ORIGIN}/api/analytics/events`, {
      method: 'POST', headers, body: JSON.stringify({ events: [], padding: 'x'.repeat(70 * 1024) }),
    }));
    expect(oversized.status).toBe(413);
    expect((await oversized.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
