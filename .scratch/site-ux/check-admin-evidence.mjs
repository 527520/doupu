import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch();
try {
  // A normal-browser UA is a test fixture: headless events are intentionally excluded from reports.
  const guest = await browser.newContext({ baseURL: 'https://127.0.0.1:3443', ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36' });
  const visitor = await guest.newPage();
  await visitor.goto('/privacy');
  await visitor.getByRole('button', { name: '同意匿名统计', exact: true }).click();
  await expect.poll(async () => (await guest.cookies()).some((cookie) => cookie.name === 'doupu_visitor')).toBe(true);
  const events = await visitor.evaluate(async () => {
    const response = await fetch('/api/analytics/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: [{ name: 'page_viewed', properties: { surface: 'home' }, path: '/', eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() }] }) });
    return response.json();
  });
  expect(events.accepted).toBeGreaterThan(0);
  await guest.close();

  const context = await browser.newContext({ baseURL: 'https://127.0.0.1:3443', ignoreHTTPSErrors: true });
  await context.addCookies([{ name: 'doupu_analytics_consent', value: 'denied', url: 'https://127.0.0.1:3443', secure: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  await page.goto('/login?next=/admin/analytics');
  await page.getByLabel('邮箱', { exact: true }).fill('e2e-admin@example.com');
  await page.getByLabel('密码', { exact: true }).fill('E2e-pass-123!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('匿名分析校样');
  const inspect = async (name) => {
    for (const width of [350, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      expect(overflow.scroll, `${name} ${width}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(width);
      const axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations.filter((item) => ['critical', 'serious'].includes(item.impact)).map((item) => ({ id: item.id, nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
      if ([350, 1440].includes(width)) await page.screenshot({ path: resolve(`.scratch/site-ux/evidence-${name}-${width}.png`), fullPage: true });
      console.log(JSON.stringify({ scene: name, width, noOverflow: true, seriousAxe: 0 }));
    }
  };
  await expect(page.locator('.admin-advanced-filters')).not.toHaveAttribute('open');
  await expect(page.locator('.analytics-chart circle').first()).toBeVisible();
  await page.locator('.analytics-chart circle').first().focus();
  await expect(page.locator('.analytics-chart circle').first()).toBeFocused();
  await inspect('analytics');
  await page.getByText('更多筛选：设备、来源与 UTM', { exact: true }).click();
  await inspect('analytics-expanded');
  await page.goto('/admin/analytics?start=invalid&device=mobile');
  await expect(page.locator('main [role=alert]')).toContainText('部分查询参数无效');
  const current = new Date(); const old = new Date(current); old.setMonth(old.getMonth() - 6);
  await page.goto(`/admin/analytics?start=${old.toISOString().slice(0, 10)}&end=${current.toISOString().slice(0, 10)}&device=mobile`);
  await expect(page.getByText(/已自动忽略日期与事件名以外/)).toBeVisible();
  await expect(page.locator('.admin-advanced-filters')).toHaveAttribute('open');
  await expect(page.getByText(/当前为长期聚合模式/)).toBeVisible();

  await page.goto('/admin/audit');
  const trigger = page.locator('.admin-object-list button').first();
  await expect(trigger).toBeVisible();
  await inspect('audit-queue');
  await page.setViewportSize({ width: 350, height: 900 });
  await trigger.click(); await expect(page.locator('.admin-task-detail')).toBeFocused();
  await inspect('audit-detail');
  await page.setViewportSize({ width: 350, height: 600 });
  await page.getByRole('button', { name: '返回队列' }).click(); await expect(trigger).toBeFocused();
  let failures = 1;
  await page.route('**/api/admin/audit?*', async (route) => failures-- > 0 ? route.fulfill({ status: 503, json: { error: { message: '本地模拟读取失败' } } }) : route.continue());
  await page.getByLabel('搜索动作、目标 ID 或请求 ID').fill('does-not-exist');
  await page.getByRole('button', { name: '查询审计' }).click();
  await expect(page.locator('main [role=alert]')).toContainText('本地模拟读取失败');
  await page.getByRole('button', { name: '重新读取' }).click();
  await expect(page.locator('main [role=alert]')).toHaveCount(0);
  await expect(page.locator('.admin-object-list button')).toHaveCount(0);

  await page.goto('/admin/system');
  await expect(page.getByText('数据库实际执行时间', { exact: true })).toBeVisible();
  await expect(page.getByText('未接入', { exact: true })).toBeVisible();
  await inspect('system');
  await context.close();
} finally { await browser.close(); }
