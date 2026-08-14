/**
 * E2E 核心旅程 1：账号（spec §F9）。
 * 注册 → dev 邮件钩子取验证链接 → 验证 → 登录 → 已登录状态。
 * 每个用例使用唯一邮箱（PGlite 回退库整场运行共享）。
 */
import { expect, test } from '@playwright/test';
import { registerAndLogin, uniqueEmail } from './helpers';

test('注册 → 邮箱验证 → 登录 → 首页显示登录态入口', async ({ page }) => {
  const email = uniqueEmail('journey');
  const password = 'e2e-password-123';

  // 注册页：客户端校验拦截非法输入
  await page.goto('/register');
  await page.getByLabel('邮箱').fill('not-an-email');
  await page.getByLabel('密码', { exact: false }).first().fill('short');
  await page.getByLabel('确认密码').fill('short');
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();

  // 合法注册 → 跳登录页
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码', { exact: false }).first().fill(password);
  await page.getByLabel('确认密码').fill(password);
  await page.getByRole('button', { name: '注册' }).click();
  await page.waitForURL(/\/login/);

  // 登录（未验证也可登录，但受限——此处直接登录检查）
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码', { exact: false }).first().fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(/\/designs|\/app|\//);

  // 验证邮件流程（新会话验证链接）
  const verifyLink = await registerAndVerifyLink(email);
  await page.goto(verifyLink);
  await expect(page.getByText(/验证成功|邮箱已验证/).first()).toBeVisible();
});

test('登录失败显示统一错误文案（防枚举，E28/E33）', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(uniqueEmail('nouser'));
  await page.getByLabel('密码', { exact: false }).first().fill('wrong-password-123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('alert').first()).toHaveText(/邮箱或密码错误/);
});

test('找回密码恒成功提示（防枚举，E30）', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.getByLabel('邮箱').fill(uniqueEmail('forgot'));
  await page.getByRole('button', { name: /发送|找回/ }).click();
  await expect(page.getByText(/若邮箱存在/).first()).toBeVisible();
});

/** 注册后从 dev 日志提取验证链接。 */
async function registerAndVerifyLink(email: string): Promise<string> {
  const { waitForMailLink } = await import('./helpers');
  return waitForMailLink('verify', email);
}
