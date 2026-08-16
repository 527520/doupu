import { afterEach, describe, expect, it } from 'vitest';
import { isDevMailMode } from './mailer';

describe('isDevMailMode（安全自查 L4）', () => {
  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SES_SECRET_ID;
  });

  it('未配置任何发信渠道 → dev 模式', () => {
    expect(isDevMailMode()).toBe(true);
  });

  it('仅配置 SMTP → 非 dev 模式', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    expect(isDevMailMode()).toBe(false);
  });

  it('仅配置 SES → 非 dev 模式（测试环境配 SES 时不再误发 x-dev-mail-link）', () => {
    process.env.SES_SECRET_ID = 'ses-id';
    expect(isDevMailMode()).toBe(false);
  });
});
