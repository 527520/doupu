/**
 * SES 发信适配器测试：
 * - TC3 签名结构/确定性/敏感性 + 与内联参考计算的交叉校验；
 * - 请求体字段与「无凭证泄露」；
 * - sendViaTencentSes 成功/错误映射；
 * - mailer SES 分支接线与熔断器。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { buildSesSendRequest, sendViaTencentSes, SES_ACTION, SES_HOST, SES_VERSION } from './tencentSes';
import { isMailCircuitOpen, openMailCircuit, sendMail } from './mailer';

const creds = {
  secretId: 'AKID-test-secret-id',
  secretKey: 'SUPER-secret-key-material-0123456789',
  region: 'ap-guangzhou',
  from: 'noreply@doupu.fun',
};
const mail = { to: 'user@example.com', subject: '验证你的豆谱账号', html: '<p>hi</p>', text: 'hi' };
const fixedDate = new Date('2026-08-15T08:00:00.000Z'); // timestamp 1784692800

describe('buildSesSendRequest（TC3 签名结构）', () => {
  it('请求体包含 SendEmail 全部字段且无密钥泄露', () => {
    const req = buildSesSendRequest(creds, mail, fixedDate);
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body.FromEmailAddress).toBe(creds.from);
    expect(body.Destination).toEqual([mail.to]);
    expect(body.Subject).toBe(mail.subject);
    // Html/Text 必须 base64（SES 要求）
    expect(body.Simple).toEqual({
      Html: Buffer.from(mail.html, 'utf8').toString('base64'),
      Text: Buffer.from(mail.text, 'utf8').toString('base64'),
    });
    expect(req.body).not.toContain(creds.secretKey);
    expect(JSON.stringify(req.headers)).not.toContain(creds.secretKey);
    expect(req.headers.Authorization).toContain(creds.secretId);
  });

  it('头符合 API 3.0 约定，且不显式设置 Host（fetch 禁止，由运行时生成）', () => {
    const req = buildSesSendRequest(creds, mail, fixedDate);
    expect(req.headers['X-TC-Action']).toBe(SES_ACTION);
    expect(req.headers['X-TC-Version']).toBe(SES_VERSION);
    expect(req.headers['X-TC-Timestamp']).toBe(String(Math.floor(fixedDate.getTime() / 1000)));
    expect(req.headers['X-TC-Region']).toBe('ap-guangzhou');
    expect(req.headers['Content-Type']).toContain('application/json');
    expect(req.headers.Authorization).toMatch(/^TC3-HMAC-SHA256 Credential=/);
    expect(req.headers.Authorization).toContain('SignedHeaders=content-type;host');
    expect(req.headers.Host).toBeUndefined();
    expect(req.url).toBe(`https://${SES_HOST}`);
  });

  it('签名确定性：同一输入 → 同一签名', () => {
    const a = buildSesSendRequest(creds, mail, fixedDate);
    const b = buildSesSendRequest({ ...creds }, { ...mail }, fixedDate);
    expect(a.headers.Authorization).toBe(b.headers.Authorization);
  });

  it('签名敏感性：改密钥/改正文/改时间任一变化 → 签名变化', () => {
    const base = buildSesSendRequest(creds, mail, fixedDate).headers.Authorization;
    const otherKey = buildSesSendRequest({ ...creds, secretKey: creds.secretKey + 'x' }, mail, fixedDate);
    const otherBody = buildSesSendRequest(creds, { ...mail, text: 'bye' }, fixedDate);
    const otherTime = buildSesSendRequest(creds, mail, new Date('2026-08-15T08:00:01.000Z'));
    expect(otherKey.headers.Authorization).not.toBe(base);
    expect(otherBody.headers.Authorization).not.toBe(base);
    expect(otherTime.headers.Authorization).not.toBe(base);
  });

  it('与内联参考计算一致（CanonicalRequest → HMAC 派生链 → Signature）', () => {
    const timestamp = Math.floor(fixedDate.getTime() / 1000);
    const date = fixedDate.toISOString().slice(0, 10);
    const payload = JSON.stringify({
      FromEmailAddress: creds.from,
      Destination: [mail.to],
      Subject: mail.subject,
      Simple: {
        Html: Buffer.from(mail.html, 'utf8').toString('base64'),
        Text: Buffer.from(mail.text, 'utf8').toString('base64'),
      },
    });
    const canonicalRequest = [
      'POST', '/', '',
      'content-type:application/json; charset=utf-8',
      `host:${SES_HOST}`, '',
      'content-type;host',
      createHash('sha256').update(payload, 'utf8').digest('hex'),
    ].join('\n');
    const stringToSign = [
      'TC3-HMAC-SHA256',
      String(timestamp),
      `${date}/ses/tc3_request`,
      createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
    ].join('\n');
    const hmac = (key: string | Buffer, data: string): Buffer =>
      createHmac('sha256', key).update(data, 'utf8').digest();
    const kDate = hmac(`TC3${creds.secretKey}`, date);
    const kService = hmac(kDate, 'ses');
    const kSigning = hmac(kService, 'tc3_request');
    const expected = hmac(kSigning, stringToSign).toString('hex');

    const req = buildSesSendRequest(creds, mail, fixedDate);
    expect(req.headers.Authorization).toContain(`Signature=${expected}`);
  });
});

describe('sendViaTencentSes', () => {
  it('成功：2xx 且无业务错误 → 正常返回，fetch 收到签名请求', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ Response: { RequestId: 'req-1' } }), { status: 200 }),
    );
    await sendViaTencentSes(creds, mail, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://${SES_HOST}`);
    expect(init.method).toBe('POST');
    expect(JSON.stringify(init.headers)).not.toContain(creds.secretKey);
  });

  it('业务错误：抛错只含 code + 官方 Message，无密钥', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ Response: { Error: { Code: 'FailedOperation.EmailAddressIsNotVerified', Message: '发信地址未验证' } } }),
        { status: 200 },
      ),
    );
    await expect(sendViaTencentSes(creds, mail, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      'TencentSES FailedOperation.EmailAddressIsNotVerified 发信地址未验证',
    );
  });

  it('HTTP 错误且响应体非 JSON：抛错含 HTTP 状态', async () => {
    const fetchImpl = vi.fn(async () => new Response('oops', { status: 500 }));
    await expect(sendViaTencentSes(creds, mail, fetchImpl as unknown as typeof fetch)).rejects.toThrow('HTTP_500');
  });
});

describe('mailer SES 分支与熔断器', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    openMailCircuit(Date.now() - 120_000); // 复位熔断器，避免跨测试污染
    vi.unstubAllGlobals();
  });

  it('配置 SES_* 时经 API 发信，不走日志分支', async () => {
    process.env.SES_SECRET_ID = creds.secretId;
    process.env.SES_SECRET_KEY = creds.secretKey;
    process.env.SES_FROM = creds.from;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ Response: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    await sendMail(mail.to, mail.subject, mail.html, mail.text);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('SES 发送失败：上抛 + 打开熔断器（60 秒后自然关闭）', async () => {
    process.env.SES_SECRET_ID = creds.secretId;
    process.env.SES_SECRET_KEY = creds.secretKey;
    process.env.SES_FROM = creds.from;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(sendMail(mail.to, mail.subject, mail.html, mail.text)).rejects.toThrow('network down');
    expect(isMailCircuitOpen()).toBe(true);
    expect(isMailCircuitOpen(Date.now() + 61_000)).toBe(false);
  });

  it('无任何发信通道：走日志分支、不上抛、不打开熔断器', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SES_SECRET_ID;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendMail(mail.to, mail.subject, mail.html, mail.text);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(isMailCircuitOpen()).toBe(false);
    logSpy.mockRestore();
  });
});
