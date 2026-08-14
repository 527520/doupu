import { describe, expect, it } from 'vitest';
import { resetPasswordTemplate, verifyEmailTemplate } from './mailTemplate';

describe('mailTemplate', () => {
  it('验证模板包含链接、主题与有效期说明', () => {
    const t = verifyEmailTemplate('http://localhost:3000/verify-email?token=abc');
    expect(t.subject).toContain('豆谱');
    expect(t.html).toContain('href="http://localhost:3000/verify-email?token=abc"');
    expect(t.text).toContain('http://localhost:3000/verify-email?token=abc');
    expect(t.text).toContain('24 小时');
    expect(t.html).toContain('24 小时');
  });

  it('重置模板包含链接、主题与 1 小时有效期说明', () => {
    const t = resetPasswordTemplate('http://localhost:3000/reset-password?token=xyz');
    expect(t.subject).toContain('密码');
    expect(t.html).toContain('href="http://localhost:3000/reset-password?token=xyz"');
    expect(t.text).toContain('http://localhost:3000/reset-password?token=xyz');
    expect(t.text).toContain('1 小时');
    expect(t.html).toContain('1 小时');
  });

  it('特殊字符链接被正确嵌入（无注入破坏）', () => {
    const link = 'http://localhost:3000/verify-email?token=a&b=c<d>';
    const t = verifyEmailTemplate(link);
    expect(t.text).toContain(link);
  });
});
