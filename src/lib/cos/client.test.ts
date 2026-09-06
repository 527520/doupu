import { describe, expect, it, vi } from 'vitest';
import { buildCosAuthorization, CosError, createCosClient, resolveOriginalsCosConfig } from './client';

describe('buildCosAuthorization', () => {
  it('produces the documented header layout with sorted lowercase lists', () => {
    const authorization = buildCosAuthorization('AKIDEXAMPLE', 'SECRET', {
      method: 'PUT', path: '/originals/中文 名.jpg', headers: { Host: 'b.cos.ap-guangzhou.myqcloud.com', 'Content-Type': 'image/jpeg' },
      startTime: 1700000000, endTime: 1700000600,
    });
    expect(authorization).toMatch(/^q-sign-algorithm=sha1&q-ak=AKIDEXAMPLE&q-sign-time=1700000000;1700000600&q-key-time=1700000000;1700000600&q-header-list=content-type;host&q-url-param-list=&q-signature=[0-9a-f]{40}$/u);
  });

  it('is deterministic for the same input and changes with any signed component', () => {
    const base = { method: 'GET', path: '/a', headers: { host: 'h' }, startTime: 1, endTime: 2 };
    expect(buildCosAuthorization('id', 'key', base)).toBe(buildCosAuthorization('id', 'key', base));
    expect(buildCosAuthorization('id', 'key', base)).not.toBe(buildCosAuthorization('id', 'key', { ...base, path: '/b' }));
    expect(buildCosAuthorization('id', 'key', base)).not.toBe(buildCosAuthorization('id', 'other', base));
  });
});

describe('createCosClient', () => {
  const config = { secretId: 'id', secretKey: 'key', bucket: 'doupu-originals-125', region: 'ap-guangzhou', now: () => new Date(1700000000000) };

  it('PUTs bytes with signed host header and content type', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    const client = createCosClient({ ...config, fetcher });
    await client.putObject('originals/r1/abc.png', new Uint8Array([1, 2, 3]), 'image/png');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://doupu-originals-125.cos.ap-guangzhou.myqcloud.com/originals/r1/abc.png');
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('image/png');
    expect(headers['content-length']).toBe('3');
    expect(headers.authorization).toContain('q-header-list=content-length;content-type;host');
  });

  it('maps 404 to null on GET/HEAD, treats 404 delete as success and surfaces COS error codes', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }));
    const client = createCosClient({ ...config, fetcher });
    expect(await client.getObject('missing')).toBeNull();
    expect(await client.headObject('missing')).toBeNull();
    await expect(client.deleteObject('missing')).resolves.toBeUndefined();
    const failure: Partial<CosError> = { status: 403, cosCode: 'AccessDenied', operation: 'PutObject' };
    await expect(client.putObject('k', new Uint8Array(1), 'image/png')).rejects.toMatchObject(failure);
  });

  it('returns object bytes and content type on GET', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([9, 8]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const client = createCosClient({ ...config, fetcher });
    const object = await client.getObject('k');
    expect(object).toMatchObject({ contentType: 'image/jpeg', contentLength: 2 });
    expect(Array.from(object!.body)).toEqual([9, 8]);
  });
});

describe('resolveOriginalsCosConfig', () => {
  it('shares the backup bucket and credentials by default and lets COS_ORIGINALS_* override each part', () => {
    expect(resolveOriginalsCosConfig({})).toBeNull();
    expect(resolveOriginalsCosConfig({ COS_SECRET_ID: 'a', COS_SECRET_KEY: 'b', COS_REGION: 'r' })).toBeNull();
    expect(resolveOriginalsCosConfig({ COS_SECRET_ID: 'a', COS_SECRET_KEY: 'b', COS_REGION: 'r', COS_BUCKET: 'shared' }))
      .toEqual({ secretId: 'a', secretKey: 'b', bucket: 'shared', region: 'r' });
    expect(resolveOriginalsCosConfig({ COS_SECRET_ID: 'a', COS_SECRET_KEY: 'b', COS_REGION: 'r', COS_BUCKET: 'shared', COS_ORIGINALS_BUCKET: 'o' }))
      .toEqual({ secretId: 'a', secretKey: 'b', bucket: 'o', region: 'r' });
    expect(resolveOriginalsCosConfig({ COS_SECRET_ID: 'a', COS_SECRET_KEY: 'b', COS_REGION: 'r', COS_ORIGINALS_BUCKET: 'o', COS_ORIGINALS_SECRET_ID: 'x', COS_ORIGINALS_SECRET_KEY: 'y', COS_ORIGINALS_REGION: 'z' }))
      .toEqual({ secretId: 'x', secretKey: 'y', bucket: 'o', region: 'z' });
  });
});
