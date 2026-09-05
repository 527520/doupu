import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3109' });
  const page = await context.newPage();
  const inspect = async (name, width) => {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('h1')).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
    await page.screenshot({ path: resolve(`.scratch/site-ux/${name}-${width}.png`), fullPage: true });
    console.log(JSON.stringify({ name, width, noOverflow: true, seriousAxe: 0 }));
  };
  await page.goto('/login?next=%2Fcommunity%2Fsubmit');
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  for (const route of ['login', 'register', 'forgot-password', 'reset-password', 'verify-email', 'help', 'privacy', 'about', 'community/rules', 'community/copyright']) {
    await page.goto(`/${route}?next=%2Fcommunity%2Fsubmit`);
    for (const width of [350, 390, 768, 1280, 1440]) await inspect(`secondary-${route.replaceAll('/', '-')}`, width);
  }
  await page.goto('/login?next=%2Faccount');
  await page.getByLabel('邮箱', { exact: true }).fill('e2e-user@example.com');
  await page.getByLabel('密码', { exact: true }).fill('E2e-pass-123!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('button', { name: '注销账号', exact: true })).toBeVisible();
  for (const width of [350, 390, 768, 1280, 1440]) await inspect('secondary-account', width);
  await page.getByRole('button', { name: '注销账号', exact: true }).click();
  for (const width of [350, 390]) {
    await page.setViewportSize({ width, height: 600 });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('公开作品');
    await expect(dialog.getByRole('button', { name: '确认注销' })).toBeDisabled();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.screenshot({ path: resolve(`.scratch/site-ux/secondary-delete-${width}.png`) });
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const design = await page.evaluate(async () => (await (await fetch('/api/designs')).json()).items.find((item) => item.name === 'E2E 私人设计'));
  const share = await page.evaluate(async (id) => (await (await fetch(`/api/designs/${id}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()), design.id);
  expect(share.path).toMatch(/^\/s\//);
  await page.goto(share.path);
  for (const width of [350, 390, 768, 1280, 1440]) await inspect('secondary-share', width);
  expect(await page.locator('main').innerText()).not.toContain('e2e-user@example.com');
  await expect(page.locator('.share-studio-cta a')).toHaveAttribute('href', '/app?new=1');
  await page.goto('/privacy');
  const settings = page.getByRole('region', { name: '匿名分析偏好' });
  await settings.getByRole('button', { name: '同意', exact: true }).click();
  await expect(settings).toContainText('当前状态：已同意');
  let fail = true;
  await page.route('**/api/analytics/consent', async (route) => {
    if (fail) await route.fulfill({ status: 503, body: '{}' }); else await route.continue();
  });
  await settings.getByRole('button', { name: '撤回并清除原始数据' }).click();
  await expect(settings.getByRole('alert')).toContainText('已停止采集');
  expect((await context.cookies()).find((cookie) => cookie.name === 'doupu_analytics_consent')?.value).toBe('withdrawn');
  await page.reload();
  await expect(settings).toContainText('等待清除确认');
  await expect(settings.getByRole('button', { name: '同意', exact: true })).toBeDisabled();
  fail = false;
  await settings.getByRole('button', { name: '重试清除原始数据' }).click();
  await expect(settings.getByRole('status')).toContainText('已撤回同意并清除');
  expect((await context.cookies()).some((cookie) => cookie.name === 'doupu_visitor')).toBe(false);
  console.log(JSON.stringify({ pendingDeletionPersists: true, deletionRetry: true, safeAccountContext: true, readonlyShare: true, simulatedShortViewportFocus: true }));
  await context.close();
} finally { await browser.close(); }
