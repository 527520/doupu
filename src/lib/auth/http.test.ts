import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { apiError, withApiErrors } from './http';

describe('auth HTTP error boundary', () => {
  it('adds one request id to thrown and explicitly returned API errors', async () => {
    const request = new Request('http://localhost/api/auth/test', {
      headers: { 'x-request-id': 'client-request-123' },
    });
    const thrown = withApiErrors(async (_request: Request) => { throw new Error('database secret'); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrownResponse = await thrown(request);
    expect(thrownResponse.status).toBe(500);
    expect(thrownResponse.headers.get('x-request-id')).toBe('client-request-123');
    expect(await thrownResponse.json()).toEqual({
      error: { code: 'INTERNAL', message: '服务器内部错误' },
      requestId: 'client-request-123',
    });

    const returned = withApiErrors(async (_request: Request) => apiError(new AppError('UNAUTHORIZED', '请登录')));
    const returnedResponse = await returned(request);
    expect(await returnedResponse.json()).toMatchObject({ requestId: 'client-request-123' });
  });

  it('caps validation issue count and response length', async () => {
    const schema = z.object(Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`field${index}`, z.string().min(100, 'x'.repeat(100))]),
    ));
    const parsed = schema.safeParse(Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`field${index}`, ''])));
    if (parsed.success) throw new Error('expected validation failure');
    const response = apiError(parsed.error, 'validation-request');
    const body = await response.json() as { error: { message: string }; requestId: string };
    expect(body.requestId).toBe('validation-request');
    expect(body.error.message.length).toBeLessThanOrEqual(512);
    expect(body.error.message.split('；').length).toBeLessThanOrEqual(6);
  });
});
