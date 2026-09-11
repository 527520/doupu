import { describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@/lib/appInfo';
import {
  OriginalUploadError,
  canFetchRevisionOriginal,
  fetchRevisionOriginal,
  uploadRevisionOriginal,
} from './originalsClient';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('originalsClient', () => {
  it('空字节与超限在发请求前就拒绝', async () => {
    const fetcher = vi.fn();
    await expect(uploadRevisionOriginal('r1', new Uint8Array(), fetcher)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION',
    });
    const oversized = { byteLength: LIMITS.maxFileBytes + 1 } as Uint8Array;
    await expect(uploadRevisionOriginal('r1', oversized, fetcher)).rejects.toBeInstanceOf(OriginalUploadError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('上传成功返回服务端元数据；失败读 JSON 错误体，坏 JSON 则 UNKNOWN', async () => {
    const ok = vi.fn().mockResolvedValue(jsonResponse(201, {
      revisionId: 'r1',
      mimeType: 'image/png',
      byteSize: 8,
      width: 1,
      height: 1,
    }));
    await expect(uploadRevisionOriginal('r1', PNG, ok)).resolves.toMatchObject({ revisionId: 'r1', byteSize: 8 });

    const coded = vi.fn().mockResolvedValue(jsonResponse(409, { error: { code: 'CONFLICT', message: '已被占用' } }));
    await expect(uploadRevisionOriginal('r1', PNG, coded)).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: '已被占用',
    });

    const broken = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(uploadRevisionOriginal('r1', PNG, broken)).rejects.toMatchObject({
      status: 500,
      code: 'UNKNOWN',
    });
  });

  it('取回：404 与无法嗅探都当缺失；PNG 魔数成功', async () => {
    const missing = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    expect(await fetchRevisionOriginal('r1', missing)).toBeNull();

    const unknown = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    expect(await fetchRevisionOriginal('r1', unknown)).toBeNull();

    const png = vi.fn().mockResolvedValue(new Response(PNG));
    await expect(fetchRevisionOriginal('r1', png)).resolves.toEqual({ bytes: PNG, type: 'png' });

    const denied = vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: 'FORBIDDEN', message: '无权' } }));
    await expect(fetchRevisionOriginal('r1', denied)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('HEAD 探测：成功为 true，网络失败为 false', async () => {
    const ok = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    expect(await canFetchRevisionOriginal('r1', ok)).toBe(true);
    const boom = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await canFetchRevisionOriginal('r1', boom)).toBe(false);
  });
});
