import { expect, test, type Page } from '@playwright/test';
import { fillField } from './helpers';

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
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
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
  await expect(page.getByText('e***n@example.com').first()).toBeVisible();
  await page.goto('/admin/rules');
  await expect(page.getByRole('heading', { name: '审核规则' })).toBeVisible();
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: '审计记录' })).toBeVisible();
  await page.goto('/admin/system');
  await expect(page.getByText('未接入').first()).toBeVisible();
  await expect(page.getByText('0009_official_batch_links')).toBeVisible();
});
