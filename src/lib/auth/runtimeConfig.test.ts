import { describe, expect, it } from 'vitest';
import { resolveMailAdapter, validateProductionAuthAdapters } from './runtimeConfig';

describe('production auth adapters', () => {
  it('uses an explicit fake adapter outside production', () => {
    expect(resolveMailAdapter({ NODE_ENV: 'test' })).toBe('fake');
  });

  it('fails fast when production mail or alert adapters are absent or partial', () => {
    expect(() => validateProductionAuthAdapters({ NODE_ENV: 'production', APP_URL: 'https://example.com' }))
      .toThrow(/mail adapter/i);
    expect(() => validateProductionAuthAdapters({
      NODE_ENV: 'production',
      APP_URL: 'https://example.com',
      SMTP_HOST: 'smtp.example.com',
      BACKUP_ALERT_TOKEN: 'a'.repeat(32),
      ADMIN_EMAIL: 'ops@example.com',
      ANALYTICS_IP_HMAC_KEY: 'h'.repeat(32),
    })).toThrow(/SMTP_USER/);
  });

  it('accepts a complete SMTP adapter and alert channel', () => {
    expect(validateProductionAuthAdapters({
      NODE_ENV: 'production',
      APP_URL: 'https://example.com',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'mailer',
      SMTP_PASS: 'secret',
      SMTP_FROM: 'noreply@example.com',
      BACKUP_ALERT_TOKEN: 'a'.repeat(32),
      ADMIN_EMAIL: 'ops@example.com',
      ANALYTICS_IP_HMAC_KEY: 'h'.repeat(32),
    })).toEqual({ mail: 'smtp' });
  });

  it('SES 模式允许缺告警模板（告警降级为仅日志），主模板仍必填', () => {
    const ses = {
      NODE_ENV: 'production',
      APP_URL: 'https://example.com',
      SES_SECRET_ID: 'id',
      SES_SECRET_KEY: 'secret',
      SES_FROM: 'noreply@example.com',
      SES_VERIFY_TEMPLATE_ID: '101',
      SES_RESET_TEMPLATE_ID: '102',
      BACKUP_ALERT_TOKEN: 'a'.repeat(32),
      ADMIN_EMAIL: 'ops@example.com',
      ANALYTICS_IP_HMAC_KEY: 'h'.repeat(32),
    };
    // 缺告警模板：允许启动（告警走日志），而不是拒绝启动整个应用
    expect(validateProductionAuthAdapters(ses)).toEqual({ mail: 'ses' });
    expect(validateProductionAuthAdapters({ ...ses, SES_ALERT_TEMPLATE_ID: '103' }))
      .toEqual({ mail: 'ses' });
    // 验证/重置模板仍是硬要求
    expect(() => validateProductionAuthAdapters({ ...ses, SES_VERIFY_TEMPLATE_ID: '' }))
      .toThrow(/SES_VERIFY_TEMPLATE_ID/);
  });
});
