/**
 * E2E 核心旅程 4：设计云端同步（spec §F8）。
 * 登录 → 工作台保存设计 → 设计列表出现 → 第二个浏览器上下文登录同账号 →
 * 拉取到同一设计（LWW 云端同步）。
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { fillField, uniqueEmail, waitForMailLink } from './helpers';

const PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png');

async function registerAndVerifyInContext(
  context: import('@playwright/test').BrowserContext,
): Promise<{ email: string; password: string }> {
  const email = uniqueEmail('sync');
  const password = 'sync-password-123';
  const page = await context.newPage();
  await page.goto('/register');
  await fillField(page, '邮箱', email);
  await fillField(page, '密码', password);
  await fillField(page, '确认密码', password);
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.getByText(/验证邮件已发送/).first()).toBeVisible({ timeout: 15_000 });
  const link = await waitForMailLink('verify', email);
  await page.goto(link);
  await expect(page.getByText(/邮箱验证成功/).first()).toBeVisible({ timeout: 10_000 });
  await page.close();
  return { email, password };
}

async function login(page: import('@playwright/test').Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await fillField(page, '邮箱', email);
  await fillField(page, '密码', password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(/\/designs|\/app/, { timeout: 15_000 });
}

test('双设备同步：设备 A 保存 → 设备 B 登录后可见同一设计', async ({ browser }) => {
  // 两个隔离的浏览器上下文模拟两台设备
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  const { email, password } = await registerAndVerifyInContext(contextA);

  // 设备 A：登录 → 工作台生成并保存
  const pageA = await contextA.newPage();
  await login(pageA, email, password);
  await pageA.goto('/app');
  await pageA.getByLabel('图片文件选择器').setInputFiles(PHOTO);
  await pageA.getByRole('button', { name: '确认裁剪' }).click({ timeout: 15_000 });
  await expect(pageA.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });
  await fillField(pageA, '设计名称', '云端同步测试设计');
  await pageA.getByRole('button', { name: /保存/ }).click();
  // 等待保存完成（IndexedDB 写入落盘）再导航，避免慢浏览器下写入被中断
  await expect(pageA.getByText(/已保存/).first()).toBeVisible({ timeout: 15_000 });

  // 设备 A 的设计列表出现该设计
  await pageA.goto('/designs');
  await expect(pageA.getByText('云端同步测试设计').first()).toBeVisible({ timeout: 15_000 });

  // 设备 B：登录 → 设计列表可见同一设计
  const pageB = await contextB.newPage();
  await login(pageB, email, password);
  await pageB.goto('/designs');
  await expect(pageB.getByText('云端同步测试设计').first()).toBeVisible({ timeout: 15_000 });

  await contextA.close();
  await contextB.close();
});
