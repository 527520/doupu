import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock('@/lib/auth/mailer', () => ({
  isDevMailMode: () => false,
  sendMail: sendMailMock,
}));

import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { setTestDb } from '@/lib/auth/db';
import { rateLimits } from '@/../db/schema';
import { config } from '@/lib/config';
import { POST, escapeHtml, singleLine } from './route';

const ENV_KEYS = ['BACKUP_ALERT_TOKEN', 'ADMIN_EMAIL', 'SES_ALERT_TEMPLATE_ID'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

let db: TestDatabase;

function request(message = 'backup failed', ip = '203.0.113.7'): Request {
  return new Request('http://localhost/api/internal/backup-alert', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': 'backup-alert-test', 'x-real-ip': ip },
    body: JSON.stringify({ token: 'a'.repeat(32), message }),
  });
}

beforeAll(async () => {
  db = await createTestClient();
  setTestDb(db);
});

beforeEach(async () => {
  process.env.BACKUP_ALERT_TOKEN = 'a'.repeat(32);
  process.env.ADMIN_EMAIL = 'ops@example.com';
  process.env.SES_ALERT_TEMPLATE_ID = '12345';
  sendMailMock.mockReset().mockResolvedValue(undefined);
  await db.delete(rateLimits);
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

  describe('公网未鉴权入口的加固（A-13）', () => {
    it('超过每 IP 每小时上限后回 429，令牌爆破因此有代价', async () => {
      const limit = config.security.backupAlertRateLimit;
      for (let i = 0; i < limit; i++) {
        expect((await POST(request('backup failed', '198.51.100.9'))).status).toBe(204);
      }
      const blocked = await POST(request('backup failed', '198.51.100.9'));
      expect(blocked.status).toBe(429);
      expect((await blocked.json()).error.code).toBe('RATE_LIMITED');
    });

    it('限流按 IP 隔离：一个来源被封不影响备份容器自身', async () => {
      const limit = config.security.backupAlertRateLimit;
      for (let i = 0; i < limit; i++) await POST(request('noise', '198.51.100.10'));
      expect((await POST(request('real failure', '10.0.0.2'))).status).toBe(204);
    });

    it('告警内容进日志前单行化，无法伪造额外日志行', () => {
      expect(singleLine('dump failed\n[backup-alert] 备份成功')).toBe('dump failed [backup-alert] 备份成功');
      expect(singleLine('a\r\n\tb')).toBe('a b');
    });

    it('告警内容进邮件正文前转义，不能注入 HTML', async () => {
      expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
        '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
      );
      await POST(request('<b>dump</b> failed', '10.0.0.3'));
      expect(sendMailMock).toHaveBeenCalledWith(
        'ops@example.com',
        '豆谱备份告警',
        '<p>&lt;b&gt;dump&lt;/b&gt; failed</p>',
        '<b>dump</b> failed',
        expect.anything(),
      );
    });
  });
});
