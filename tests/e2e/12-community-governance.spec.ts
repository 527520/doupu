import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fillField } from './helpers';

const BATCH_PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png');

async function login(page: Page, email: string, next = '/community') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await fillField(page, '邮箱', email);
  await fillField(page, '密码', 'E2e-pass-123!');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(new RegExp(next.replace('/', '\\/')));
}

test('游客只能看到已发布版本，后台要求登录', async ({ page }) => {
  await page.goto('/community');
  await expect(page.getByRole('heading', { name: /E2E 已公开作品|E2E 待审修改版/ })).toBeVisible();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect.poll(() => new URL(page.url()).searchParams.get('next')).toBe('/admin');
});

test('已验证用户引用独立副本并发布评论', async ({ page }, testInfo) => {
  await login(page, 'e2e-user@example.com');
  await page.goto('/community');
  await page.locator('.community-card a').first().click();
  await page.getByRole('button', { name: '创建私人副本' }).click();
  await expect(page.getByText(/私人副本已创建/)).toBeVisible();
  await page.getByLabel('发表评论').fill(`E2E ${testInfo.project.name} 普通评论`);
  await page.getByRole('button', { name: '发布评论' }).click();
  await expect(page.getByText(/评论已发布|审核通过后公开/)).toBeVisible();
});

test('moderator 只能进入治理模块，管理员模块不出现在导航', async ({ page }, testInfo) => {
  await login(page, 'e2e-moderator@example.com', '/admin/reviews');
  await expect(page.getByRole('heading', { name: '作品审核' })).toBeVisible();
  await expect(page.getByRole('link', { name: '匿名分析' })).toHaveCount(0);
  if (testInfo.project.name === 'chromium') {
    await expect(page.getByText('E2E 待审修改版').first()).toBeVisible();
    await page.getByText('E2E 待审修改版').first().click();
    await page.getByLabel('审核理由').fill('E2E 人工审核通过修改版');
    await page.getByRole('button', { name: '批准发布' }).click();
    await expect(page.getByText('队列已清空。')).toBeVisible();
  }
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '这里需要更高权限' })).toBeVisible();
});

test('admin 可读取人员、规则、审计和系统证据', async ({ page }) => {
  await login(page, 'e2e-admin@example.com', '/admin/users');
  await expect(page.getByRole('heading', { name: '人员管理' })).toBeVisible();
  await expect(page.getByText('E2E Admin').first()).toBeVisible();
  await expect(page.getByText('e2e-admin@example.com')).toHaveCount(0);
  const people = await page.evaluate(async () => (await fetch('/api/admin/users')).json());
  expect(people.items.find((item: { username: string }) => item.username === 'E2E Admin')).toMatchObject({ maskedEmail: 'e***n@example.com' });
  expect(JSON.stringify(people)).not.toContain('e2e-admin@example.com');
  await page.goto('/admin/rules');
  await expect(page.getByRole('heading', { name: '审核规则' })).toBeVisible();
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: '审计记录' })).toBeVisible();
  await page.goto('/admin/system');
  await expect(page.getByText('未接入').first()).toBeVisible();
  await expect(page.getByText('0010_analytics_time_index')).toBeVisible();
});

test('官方批次允许单项失败、保留成功草稿并只发布勾选项', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await login(page, 'e2e-admin@example.com', '/admin/batches');
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'photo-gradient-64.png', mimeType: 'image/png', buffer: readFileSync(BATCH_PHOTO) },
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not-an-image') },
  ]);
  await expect(page.getByText('photo-gradient-64.png')).toBeVisible();
  await expect(page.getByText('broken.png')).toBeVisible();

  await page.getByRole('button', { name: '开始生成' }).click();
  await expect(page.getByRole('status')).toContainText('生成完成，1 项失败', { timeout: 30_000 });
  const savedItem = page.locator('.batch-items li', { hasText: 'photo-gradient-64.png' });
  const failedItem = page.locator('.batch-items li', { hasText: 'broken.png' });
  await expect(savedItem).toContainText('saved · 100%');
  await expect(failedItem).toContainText('failed');
  await expect(failedItem.getByRole('button', { name: '重试' })).toBeEnabled();

  await savedItem.getByRole('checkbox').check();
  await page.getByRole('button', { name: '发布已勾选草稿' }).click();
  await expect(page.getByRole('status')).toHaveText('已发布 1 个官方作品。');
  await page.goto('/community');
  await expect(page.getByRole('heading', { name: '官方作品 01' })).toBeVisible();
});

test('豆社与审核后台覆盖目标宽度且无严重可访问性问题', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  const widths = [350, 390, 768, 1280, 1440] as const;
  await page.goto('/community');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { level: 1, name: '豆社' })).toBeVisible();
    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(geometry.page, `豆社在 ${width}px 下不得横向溢出`).toBeLessThanOrEqual(geometry.viewport);
  }
  const communityAxe = await new AxeBuilder({ page }).include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(communityAxe.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);

  await login(page, 'e2e-moderator@example.com', '/admin/reviews');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: '作品审核' })).toBeVisible();
    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(geometry.page, `审核后台在 ${width}px 下不得横向溢出`).toBeLessThanOrEqual(geometry.viewport);
  }
  const adminAxe = await new AxeBuilder({ page }).include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(adminAxe.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
});
