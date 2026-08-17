/**
 * 发信成本防护测试（PGlite 真实限流语义）：
 * 每邮箱每日 / 每 IP 每小时 / 全局每日三层，验证优先级与窗口隔离。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { checkMailSendLimits, reserveMailSendLimits } from './mailLimits';

let db: TestDatabase;
const now = new Date('2026-08-15T08:00:00.000Z');

beforeAll(async () => {
  db = await createTestClient();
  // 成本防护仅在配置真实发信渠道时生效（测试需显式开启）
  process.env.SES_SECRET_ID = 'test-id';
});

afterAll(async () => {
  // PGlite 内存库无需显式关闭；清 env 防串扰
  delete process.env.SES_SECRET_ID;
  delete process.env.MAIL_DAILY_SEND_LIMIT;
});

describe('checkMailSendLimits', () => {
  it('释放失败发送的预占后，不消耗实际发送配额', async () => {
    const freshDb = await createTestClient();
    const first = await reserveMailSendLimits(freshDb, {
      email: 'failed@example.com', ip: '8.8.8.8', emailLimit: 1, now,
    });
    expect(first.result).toBe('ok');
    await first.release();
    const retry = await reserveMailSendLimits(freshDb, {
      email: 'failed@example.com', ip: '8.8.8.8', emailLimit: 1, now,
    });
    expect(retry.result).toBe('ok');
  });

  it('每邮箱每日：同邮箱不同 IP 换着来，超过上限后返回 emailLimited', async () => {
    const email = 'victim@example.com';
    for (let i = 0; i < 5; i++) {
      const result = await checkMailSendLimits(db, { email, ip: `1.1.1.${i}`, now });
      expect(result).toBe('ok');
    }
    const sixth = await checkMailSendLimits(db, { email, ip: '9.9.9.9', now });
    expect(sixth).toBe('emailLimited');
  });

  it('每 IP 每小时：同 IP 换邮箱，超过 20 后返回 ipLimited', async () => {
    const ip = '10.0.0.99';
    for (let i = 0; i < 20; i++) {
      const result = await checkMailSendLimits(db, { email: `user${i}@example.com`, ip, now });
      expect(result).toBe('ok');
    }
    const extra = await checkMailSendLimits(db, { email: 'user99@example.com', ip, now });
    expect(extra).toBe('ipLimited');
  });

  it('全局每日：MAIL_DAILY_SEND_LIMIT=3 时第 4 封（全新邮箱+IP）返回 globalLimited', async () => {
    // 独立库实例：全局计数不受本文件其他用例累积影响
    const freshDb = await createTestClient();
    process.env.MAIL_DAILY_SEND_LIMIT = '3';
    for (let i = 0; i < 3; i++) {
      const result = await checkMailSendLimits(freshDb, {
        email: `g${i}@example.com`,
        ip: `2.2.2.${i}`,
        now: new Date(now.getTime() + i * 1000),
      });
      expect(result).toBe('ok');
    }
    const fourth = await checkMailSendLimits(freshDb, { email: 'g9@example.com', ip: '2.2.2.9', now });
    expect(fourth).toBe('globalLimited');
    delete process.env.MAIL_DAILY_SEND_LIMIT;
  });

  it('窗口隔离：下一个窗口（明天）计数归零', async () => {
    const email = 'tomorrow@example.com';
    for (let i = 0; i < 6; i++) {
      await checkMailSendLimits(db, { email, ip: `3.3.3.${i}`, now });
    }
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const result = await checkMailSendLimits(db, { email, ip: '3.3.3.9', now: tomorrow });
    expect(result).toBe('ok');
  });
});
