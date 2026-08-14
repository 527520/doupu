/**
 * E2E 核心旅程 1：账号（spec §F9）。
 * 注册 → dev 邮件钩子取验证链接 → 验证 → 登录 → 已登录状态。
 */
import { expect, test } from '@playwright/test';
import { fillField, uniqueEmail, waitForMailLink } from './helpers';

const errorAlert = (page: import('@playwright/test').Page) => page.locator('p[role="alert"]');

test('注册 → 邮箱验证 → 登录 → 首页显示登录态入口', async ({ page }) => {
  const email = uniqueEmail('journey');
  const password = 'e2e-password-123';

  // 注册页：客户端校验拦截非法输入
  await page.goto('/register');
  await fillField(page, '邮箱', 'not-an-email');
  await fillField(page, '密码', 'short');
  await fillField(page, '确认密码', 'short');
  await page.getByRole('button', { name: '注册' }).click();
  await expect(errorAlert(page).first()).toBeVisible({ timeout: 10_000 });

  // 合法注册 → 显示「验证邮件已发送」+ 前往登录
  await fillField(page, '邮箱', email);
  await fillField(page, '密码', password);
  await fillField(page, '确认密码', password);
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.getByText(/验证邮件已发送/).first()).toBeVisible({ timeout: 15_000 });

  // 验证邮件 → 成功页
  const link = await waitForMailLink('verify', email);
  await page.goto(link);
  await expect(page.getByText(/邮箱验证成功/).first()).toBeVisible({ timeout: 10_000 });

  // 登录
  await page.goto('/login');
  await fillField(page, '邮箱', email);
  await fillField(page, '密码', password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(/\/designs|\/app/, { timeout: 15_000 });
});

test('登录失败显示统一错误文案（防枚举，E28/E33）', async ({ page }) => {
  await page.goto('/login');
  await fillField(page, '邮箱', uniqueEmail('nouser'));
  await fillField(page, '密码', 'wrong-password-123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(errorAlert(page).first()).toHaveText(/邮箱或密码错误/, { timeout: 10_000 });
});

test('找回密码恒成功提示（防枚举，E30）', async ({ page }) => {
  await page.goto('/forgot-password');
  await fillField(page, '邮箱', uniqueEmail('forgot'));
  await page.getByRole('button', { name: /提交|发送/ }).click();
  await expect(page.getByText(/若该邮箱已注册|重置邮件已发送/).first()).toBeVisible({ timeout: 10_000 });
});
