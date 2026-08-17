import { describe, expect, it, vi } from 'vitest';

const { publicConfigMock } = vi.hoisted(() => ({
  publicConfigMock: vi.fn(),
}));

vi.mock('@/lib/config', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/config')>(),
  publicConfig: publicConfigMock,
}));

import { GET } from './route';

describe('GET /api/config', () => {
  it('未知异常返回统一 JSON，并沿用请求 ID', async () => {
    publicConfigMock.mockImplementationOnce(() => {
      throw new Error('configuration secret');
    });
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);

    const response = await GET(new Request('http://localhost/api/config', {
      headers: { 'x-request-id': 'config-request-123' },
    }));

    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('config-request-123');
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL', message: '服务器内部错误' },
      requestId: 'config-request-123',
    });
  });
});
