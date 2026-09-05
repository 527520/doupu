import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';
import { fillField } from './helpers';
import { localHttps } from './localHttps';

test('HTTPS 同意初始化失败仍可看到错误并重试，失败期间不发送事件', async ({ browser, baseURL }) => {
  const proxy = await localHttps(baseURL!);
  const context = await browser.newContext({ baseURL: proxy.origin, ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    let grants = 0; let events = 0;
    await page.route('**/api/analytics/consent', async (route) => { grants++; await route.fulfill({ status: 503, json: { error: { code: 'UNKNOWN' } } }); });
    await page.route('**/api/analytics/events', async (route) => { events++; await route.fulfill({ status: 204 }); });
    await page.goto('/');
    const banner = page.getByRole('complementary', { name: '匿名使用数据偏好' });
    await banner.getByRole('button', { name: '同意匿名统计' }).click();
    await expect(banner.getByRole('alert')).toContainText('初始化');
    expect(grants).toBe(1); expect(events).toBe(0);
    await banner.getByRole('button', { name: '同意匿名统计' }).click();
    await expect.poll(() => grants).toBe(2);
    await expect(banner.getByRole('alert')).toBeVisible(); expect(events).toBe(0);
  } finally { await context.close(); await proxy.close(); }
});

test('损坏的批次历史不能替换已选择的本地图片，重读后可恢复', async ({ page }) => {
  await page.route('**/api/admin/batches', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: { items: [{ id: '00000000-0000-4000-8000-000000000001', status: 'completed' }] } });
    else await route.continue();
  });
  await page.goto('/login?next=/admin/batches');
  await fillField(page, '邮箱', 'e2e-admin@example.com'); await fillField(page, '密码', 'E2e-pass-123!');
  await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page).toHaveURL(/\/admin\/batches$/);
  await page.getByLabel('选择图片', { exact: true }).setInputFiles(resolve('tests/fixtures/photo-gradient-64.png'));
  await page.getByText('恢复已保存批次（最近 50 批）').click();
  const history = page.locator('.batch-history');
  await expect(history.getByRole('alert')).toContainText('队列加载失败');
  await expect(page.locator('.batch-items > li')).toHaveCount(1);
  await expect(history.locator('li button')).toHaveCount(0);
  await page.unroute('**/api/admin/batches');
  await history.getByRole('button', { name: '重新读取' }).click();
  await expect(history.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.batch-items > li')).toHaveCount(1);
});

test('首页精选与最新同时可见，五宽度无横向溢出且可访问', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium');
  const work = (id: string, featured: boolean) => ({ id, title: featured ? '人工选中的旧作品' : '今天公开的新作品', featured, width: 2, height: 2, author: { displayName: '本地视觉夹具' }, preview: { version: 1, width: 2, height: 2, originalWidth: 2, originalHeight: 2, cells: ['#FAF4C8', '#F4C6D7', '#F4C6D7', '#FAF4C8'], colorBand: ['#FAF4C8', '#F4C6D7'] } });
  await page.route('**/api/community/works?sort=*', async (route) => {
    const featured = route.request().url().endsWith('featured');
    await route.fulfill({ json: { items: [work(featured ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002', featured)] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本期作品校样' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近公开作品' })).toBeVisible();
  for (const width of [350, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect((await new AxeBuilder({ page }).analyze()).violations.filter((entry) => ['serious', 'critical'].includes(entry.impact ?? ''))).toEqual([]);
    if ([350, 1440].includes(width)) await page.screenshot({ path: resolve(`.scratch/site-ux/home-shelves-${width}.png`), fullPage: true });
  }
});
