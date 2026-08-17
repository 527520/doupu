import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock('@/lib/auth/mailer', () => ({
  isDevMailMode: () => false,
  sendMail: sendMailMock,
}));

import { POST } from './route';

const ENV_KEYS = ['BACKUP_ALERT_TOKEN', 'ADMIN_EMAIL', 'SES_ALERT_TEMPLATE_ID'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function request(message = 'backup failed'): Request {
  return new Request('http://localhost/api/internal/backup-alert', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': 'backup-alert-test' },
    body: JSON.stringify({ token: 'a'.repeat(32), message }),
  });
}

beforeEach(() => {
  process.env.BACKUP_ALERT_TOKEN = 'a'.repeat(32);
  process.env.ADMIN_EMAIL = 'ops@example.com';
  process.env.SES_ALERT_TEMPLATE_ID = '12345';
  sendMailMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('POST /api/internal/backup-alert', () => {
  it('通过独立 SES 告警模板发送后才返回成功', async () => {
    const response = await POST(request('dump validation failed'));

    expect(response.status).toBe(204);
    expect(sendMailMock).toHaveBeenCalledWith(
      'ops@example.com',
      '豆谱备份告警',
      '<p>dump validation failed</p>',
      'dump validation failed',
      { sesTemplate: { templateId: '12345', templateData: { message: 'dump validation failed' } } },
    );
  });

  it('发信失败必须返回 500，不能让备份容器误报已送达', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('SES unavailable'));
    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('backup-alert-test');
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL', message: '服务器内部错误' },
      requestId: 'backup-alert-test',
    });
  });
});
