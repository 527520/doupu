import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fillField } from './helpers';

const BATCH_PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png');

function dateOffset(days: number) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

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
  const originalWorkUrl = page.url();
  await page.getByRole('button', { name: '用这张制作' }).click();
  await expect(page).toHaveURL(/\/app\?id=.+&mode=edit/);
  await expect(page.getByRole('tab', { name: '编辑', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('设计名称')).toHaveValue(/（引用）$/);
  await page.goto(originalWorkUrl);
  await page.getByLabel('发表评论').fill(`E2E ${testInfo.project.name} 普通评论`);
  await page.getByRole('button', { name: '发布评论' }).click();
  await expect(page.getByText(/评论已发布|审核通过后公开/)).toBeVisible();
});

test('评论删除独立于编辑窗口，待审评论只对本人显示', async ({ page }, testInfo) => {
  await login(page, 'e2e-user@example.com');
  await page.locator('.community-card').filter({ hasText: 'E2E' }).first().locator('a').first().click();
  const expired = page.locator('.community-comment-list li', { hasText: `E2E 可删除旧评论 ${testInfo.project.name}` });
  await expect(expired.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  await expired.getByRole('button', { name: '删除', exact: true }).click();
  await expect(expired).toHaveCount(0);
  const pending = page.locator('.community-comment-list li', { hasText: `E2E风险词 待审删除 ${testInfo.project.name}` });
  await expect(pending).toContainText('待审核');
  await pending.getByRole('button', { name: '删除', exact: true }).click();
  await expect(pending).toHaveCount(0);
  const foreign = page.locator('.community-comment-list li', { hasText: 'E2E 被举报评论' });
  await expect(foreign.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
});

test('无补充说明的举报仍显示图纸或评论内容和定位入口', async ({ page }) => {
  await login(page, 'e2e-moderator@example.com', '/admin/reports');
  const workCase = page.locator('.review-queue button', { hasText: '作品 / 其他' }).first();
  await workCase.click();
  await expect(page.getByText('被举报对象编号')).toBeVisible();
  await expect(page.locator('.report-material h3')).toHaveText('E2E 已公开作品');
  await expect(page.locator('.report-material canvas').first()).toBeVisible();
  await expect(page.getByRole('link', { name: '打开当前公开对象' })).toBeVisible();
  await page.locator('.review-queue button', { hasText: '评论 / 其他' }).first().click();
  await expect(page.locator('.report-material')).toContainText('E2E 被举报评论');
  await expect(page.getByRole('link', { name: '打开当前公开对象' })).toHaveAttribute('href', /#comment-/);
  await expect(page.getByRole('button', { name: '受理', exact: true })).toBeDisabled();
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
  await expect(page.getByText('0012_comment_publication_time')).toBeVisible();
});

test('分析后台在精确与长期聚合范围间明确切换能力', async ({ page }) => {
  await login(page, 'e2e-admin@example.com', '/admin/analytics');
  await page.goto(`/admin/analytics?start=${dateOffset(-10)}&end=${dateOffset(0)}&device=desktop&actor=user&dimension=device&funnel=communityReuse`);
  await expect(page.getByRole('heading', { name: '匿名分析校样' })).toBeVisible();
  await expect(page.getByText('当前为最近 90 天精确模式：提供范围 UV、组合筛选和漏斗。')).toBeVisible();
  await expect(page.locator('select[name="device"]')).toHaveValue('desktop');
  await expect(page.locator('select[name="actor"]')).toHaveValue('user');
  await expect(page.locator('select[name="funnel"]')).toHaveValue('communityReuse');
  await expect(page.getByRole('table')).toHaveCount(1);

  await page.goto(`/admin/analytics?start=${dateOffset(-140)}&end=${dateOffset(0)}&device=desktop&dimension=device&funnel=communityReuse`);
  await expect(page.getByText('当前为长期聚合模式：仅提供每日总量和单维分类趋势，不显示跨日 UV 或漏斗。')).toBeVisible();
  await expect(page.getByText('长期范围不支持组合筛选，已自动忽略日期与事件名以外的筛选。')).toBeVisible();
  await expect(page.getByText('仅最近 90 天原始事件支持同会话漏斗')).toBeVisible();
});

test('官方批次允许单项失败、保留成功草稿并只发布勾选项', async ({ page }) => {
  await login(page, 'e2e-admin@example.com', '/admin/batches');
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'photo-gradient-64.png', mimeType: 'image/png', buffer: readFileSync(BATCH_PHOTO) },
    { name: 'second-photo.png', mimeType: 'image/png', buffer: readFileSync(BATCH_PHOTO) },
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not-an-image') },
  ]);
  await expect(page.getByText('photo-gradient-64.png')).toBeVisible();
  await expect(page.getByText('broken.png')).toBeVisible();
  const pendingItem = page.locator('.batch-items li', { hasText: 'photo-gradient-64.png' });
  await page.locator('.batch-studio > details').getByLabel('目标宽度').fill('30');
  await pendingItem.getByText('逐项参数覆盖').click();
  await pendingItem.getByLabel('目标宽度').fill('24');

  await page.getByRole('button', { name: '开始生成' }).click();
  await expect(page.getByRole('status')).toContainText('生成完成，1 项失败', { timeout: 30_000 });
  const savedItem = page.locator('.batch-items li', { hasText: 'photo-gradient-64.png' });
  const failedItem = page.locator('.batch-items li', { hasText: 'broken.png' });
  await expect(savedItem).toContainText('已保存 · 100%');
  await expect(failedItem).toContainText('失败');
  await expect(failedItem.getByRole('button', { name: '重试' })).toBeEnabled();
  const completedBatch = await page.evaluate(async () => (await (await fetch('/api/admin/batches')).json()).items[0]);
  expect(completedBatch).toMatchObject({ status: 'completed', successCount: 2, failureCount: 1 });
  expect(completedBatch.completedAt).not.toBeNull();

  await savedItem.getByRole('checkbox').check();
  await page.getByRole('button', { name: '发布已勾选草稿' }).click();
  await expect(page.getByRole('status')).toHaveText('已发布 1 个官方作品。');
  await expect(savedItem.getByRole('checkbox')).toHaveCount(0);
  const remaining = page.locator('.batch-items li', { hasText: 'second-photo.png' });
  await expect(remaining.getByRole('checkbox')).toBeEnabled();
  await page.reload();
  const restored = page.locator('.batch-items li').filter({ has: page.locator('input[value="官方作品 02"]') });
  await restored.getByRole('checkbox').check();
  await page.getByRole('button', { name: '发布已勾选草稿' }).click();
  await expect(page.getByRole('status')).toHaveText('已发布 1 个官方作品。');
  await expect(page.locator('.batch-items input[type="checkbox"]')).toHaveCount(0);
  await page.goto('/community');
  await expect(page.getByRole('heading', { name: '官方作品 01' }).first()).toBeVisible();
  const detail = await page.evaluate(async () => {
    const list = await (await fetch('/api/community/works?q=' + encodeURIComponent('官方作品 01'))).json();
    return (await fetch(`/api/community/works/${list.items[0].id}`)).json();
  });
  expect(detail.snapshot.params.targetWidth).toBe(24);
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
