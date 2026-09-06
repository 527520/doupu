import { describe, expect, it, vi } from 'vitest';
import { buildTmsRequest, moderateTextWithTms, resolveTmsCredentials, TmsError, tmsUserToken } from './tencentTms';

const creds = { secretId: 'AKID', secretKey: 'KEY', region: 'ap-guangzhou', bizType: 'doupu-comments' };

describe('buildTmsRequest', () => {
  it('posts the base64 content with a sanitised DataId, opaque user token and TC3 headers', () => {
    const request = buildTmsRequest(creds, { content: '你好，世界', dataId: 'check:123/456', userToken: 'abc' }, new Date('2026-09-06T00:00:00Z'));
    expect(request.url).toBe('https://tms.tencentcloudapi.com');
    expect(request.headers['X-TC-Action']).toBe('TextModeration');
    expect(request.headers['X-TC-Version']).toBe('2020-12-29');
    expect(request.headers['X-TC-Region']).toBe('ap-guangzhou');
    expect(request.headers.Authorization).toMatch(/^TC3-HMAC-SHA256 Credential=AKID\/2026-09-06\/tms\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/u);
    const body = JSON.parse(request.body);
    expect(Buffer.from(body.Content, 'base64').toString('utf8')).toBe('你好，世界');
    expect(body).toMatchObject({ BizType: 'doupu-comments', DataId: 'check-123-456', Type: 'TEXT', SourceLanguage: 'zh', User: { UserId: 'abc' } });
  });

  it('derives a stable, non-reversible user token', () => {
    expect(tmsUserToken('public-1')).toBe(tmsUserToken('public-1'));
    expect(tmsUserToken('public-1')).not.toBe(tmsUserToken('public-2'));
    expect(tmsUserToken('public-1')).toHaveLength(32);
    expect(tmsUserToken('public-1')).not.toContain('public');
  });
});

describe('moderateTextWithTms', () => {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('maps a successful response to a verdict with only the audited fields', async () => {
    const fetcher = vi.fn(async () => reply({ Response: { RequestId: 'req-1', Suggestion: 'Block', Label: 'Ad', SubLabel: 'Contact', Score: 91, Keywords: ['加微信'], DetailResults: [{ secret: true }] } }));
    const verdict = await moderateTextWithTms(creds, { content: '加微信', dataId: 'x' }, { fetcher });
    expect(verdict).toMatchObject({ suggestion: 'Block', label: 'Ad', subLabel: 'Contact', score: 91, keywords: ['加微信'], requestId: 'req-1' });
    expect(verdict.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('raises TmsError with the cloud error code, on HTTP failure, and on malformed suggestions', async () => {
    await expect(moderateTextWithTms(creds, { content: 'x', dataId: 'x' }, { fetcher: async () => reply({ Response: { Error: { Code: 'UnauthorizedOperation.Unauthorized', Message: '未开通' } } }) }))
      .rejects.toMatchObject({ name: 'TmsError', code: 'UnauthorizedOperation.Unauthorized' });
    await expect(moderateTextWithTms(creds, { content: 'x', dataId: 'x' }, { fetcher: async () => reply({}, 503) }))
      .rejects.toMatchObject({ code: 'HTTP_503' });
    await expect(moderateTextWithTms(creds, { content: 'x', dataId: 'x' }, { fetcher: async () => reply({ Response: { Suggestion: 'Maybe' } }) }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('turns a timeout into TmsError TIMEOUT', async () => {
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => { init.signal?.addEventListener('abort', () => reject(new Error('aborted'))); }));
    await expect(moderateTextWithTms(creds, { content: 'x', dataId: 'x' }, { fetcher: fetcher as unknown as typeof fetch, timeoutMs: 5 })).rejects.toBeInstanceOf(TmsError);
    await expect(moderateTextWithTms(creds, { content: 'x', dataId: 'x' }, { fetcher: fetcher as unknown as typeof fetch, timeoutMs: 5 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('resolveTmsCredentials', () => {
  it('reuses COS credentials by default, honours explicit overrides and an off switch', () => {
    expect(resolveTmsCredentials({})).toBeNull();
    expect(resolveTmsCredentials({ COS_SECRET_ID: 'a', COS_SECRET_KEY: 'b' })).toEqual({ secretId: 'a', secretKey: 'b', region: 'ap-guangzhou', bizType: undefined });
    expect(resolveTmsCredentials({ TMS_SECRET_ID: 'x', TMS_SECRET_KEY: 'y', TMS_REGION: 'ap-shanghai', TMS_BIZ_TYPE: 'biz' })).toEqual({ secretId: 'x', secretKey: 'y', region: 'ap-shanghai', bizType: 'biz' });
    expect(resolveTmsCredentials({ COS_SECRET_ID: 'a', COS_SECRET_KEY: 'b', TMS_ENABLED: 'false' })).toBeNull();
  });

  it('treats empty strings from docker compose as unset', () => {
    expect(resolveTmsCredentials({ TMS_SECRET_ID: '', TMS_SECRET_KEY: '', TMS_REGION: '', TMS_BIZ_TYPE: '', COS_SECRET_ID: 'a', COS_SECRET_KEY: 'b' }))
      .toEqual({ secretId: 'a', secretKey: 'b', region: 'ap-guangzhou', bizType: undefined });
    expect(resolveTmsCredentials({ TMS_SECRET_ID: '', TMS_SECRET_KEY: '', COS_SECRET_ID: '', COS_SECRET_KEY: '' })).toBeNull();
  });
});
