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

  const originals = { COS_SECRET_ID: 'cos', COS_SECRET_KEY: 'cos-secret', COS_REGION: 'ap-guangzhou', COS_BUCKET: 'doupu-backup-1250000000' };

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
      ...originals,
    })).toEqual({ mail: 'smtp' });
  });

  it('requires a private bucket for originals in production (D49): the backup bucket by default, COS_ORIGINALS_* to split', () => {
    const base = {
      NODE_ENV: 'production', APP_URL: 'https://example.com', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'mailer', SMTP_PASS: 'secret', SMTP_FROM: 'noreply@example.com',
      BACKUP_ALERT_TOKEN: 'a'.repeat(32), ADMIN_EMAIL: 'ops@example.com', ANALYTICS_IP_HMAC_KEY: 'h'.repeat(32),
    };
    expect(() => validateProductionAuthAdapters(base)).toThrow(/COS_BUCKET.*COS_ORIGINALS_BUCKET/);
    expect(() => validateProductionAuthAdapters({ ...base, COS_BUCKET: 'shared' })).toThrow(/COS credentials/);
    expect(validateProductionAuthAdapters({ ...base, COS_BUCKET: 'shared', COS_SECRET_ID: 'i', COS_SECRET_KEY: 'k', COS_REGION: 'r' })).toEqual({ mail: 'smtp' });
    expect(() => validateProductionAuthAdapters({ ...base, COS_ORIGINALS_BUCKET: 'b' })).toThrow(/COS credentials/);
    expect(validateProductionAuthAdapters({ ...base, COS_ORIGINALS_BUCKET: 'b', COS_ORIGINALS_SECRET_ID: 'i', COS_ORIGINALS_SECRET_KEY: 'k', COS_ORIGINALS_REGION: 'r' })).toEqual({ mail: 'smtp' });
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
      ...originals,
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
