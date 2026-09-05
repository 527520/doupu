import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ baseURL: 'https://127.0.0.1:3443', ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto('/login?next=/admin/reviews');
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill('e2e-admin@example.com');
  await page.getByLabel('密码', { exact: true }).fill('E2e-pass-123!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  await expect(page.locator('h1')).toHaveText('作品审核');
  const seed = await page.evaluate(async () => {
    const reply = await fetch('/api/admin/community/tags', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'siteux-admin-visual-tag-v2' }, body: JSON.stringify({ name: '本地验证动物标签', slug: 'siteux-admin-animals', reason: '本地后台交互验收样本', expectedVersion: 0 }) });
    return { status: reply.status, body: await reply.json() };
  });
  expect([200, 201]).toContain(seed.status);
  const inspect = async (route, phase, width) => {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, nodes: [...document.querySelectorAll('main *')].filter((node) => node.getBoundingClientRect().right > innerWidth + 1).map((node) => ({ tag: node.tagName, class: node.className, right: node.getBoundingClientRect().right })).slice(0, 12) }));
    expect(overflow.scroll, JSON.stringify({ route, phase, width, overflow })).toBeLessThanOrEqual(width);
    const axe = await new AxeBuilder({ page }).analyze();
    const violations = axe.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious');
    expect(violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
    if ([350, 1440].includes(width)) await page.screenshot({ path: resolve(`.scratch/site-ux/admin-${route}-${phase}-${width}.png`), fullPage: true });
    console.log(JSON.stringify({ route, phase, width, noOverflow: true, seriousAxe: 0 }));
  };
  for (const route of ['reviews', 'comments', 'reports', 'tags', 'users', 'rules', 'works']) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/admin/${route}`);
    if (route === 'rules') await expect(page.getByRole('button', { name: '基于当前版本编辑' })).toBeVisible();
    else await expect(page.locator('.review-queue li button, .admin-object-list li button').first()).toBeVisible();
    for (const width of [350, 390, 768, 1280, 1440]) await inspect(route, 'queue', width);
    await page.setViewportSize({ width: 350, height: 900 });
    const trigger = route === 'rules' ? page.getByRole('button', { name: '基于当前版本编辑' })
      : route === 'users' ? page.locator('.admin-object-list button').filter({ hasText: 'E2E User' })
        : page.locator('.review-queue li button, .admin-object-list li button').first();
    await trigger.click();
    const detail = page.locator('.review-preview, .admin-task-detail').first();
    await expect(detail).toBeVisible();
    await expect(detail).toBeFocused();
    await expect(page.locator('.review-queue, .admin-task-queue')).toBeHidden();
    if (['reviews', 'works'].includes(route)) await expect(detail.locator('canvas').first()).toBeVisible();
    if (route === 'reports') await expect(detail.locator('.report-material')).toBeVisible();
    for (const width of [350, 390, 768, 1280, 1440]) await inspect(route, 'detail', width);
    await page.setViewportSize({ width: 350, height: 600 });
    const toggle = page.locator('.admin-mobile-menu');
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape'); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(toggle).toBeFocused();
    await page.getByRole('button', { name: route === 'rules' ? '取消编辑' : '返回队列', exact: true }).click();
    await expect(page.locator('.review-queue, .admin-task-queue')).toBeVisible();
    await expect(trigger).toBeFocused();
  }
  await context.close();
} finally { await browser.close(); }
