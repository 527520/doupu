import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3109' });
  const page = await context.newPage();
  await page.goto('/login?next=%2Fcommunity%2Fsubmit');
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill('e2e-user@example.com');
  await page.getByLabel('密码', { exact: true }).fill('E2e-pass-123!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/community\/submit$/);
  await page.getByLabel('选择云端设计').selectOption({ label: 'E2E 私人设计' });
  await expect(page.getByLabel('公开作品标题')).toHaveValue('E2E 私人设计');
  await expect(page.getByRole('checkbox', { name: /我确认拥有发布权/ })).not.toBeChecked();
  const inspect = async (name, width) => {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
    await page.screenshot({ path: resolve(`.scratch/site-ux/${name}-${width}.png`), fullPage: true });
    console.log(JSON.stringify({ name, width, noOverflow: true, seriousAxe: 0 }));
  };
  for (const width of [350, 390, 768, 1280, 1440]) await inspect('submission', width);
  const title = `投稿恢复验证 ${Date.now()}`;
  await page.getByLabel('公开作品标题').fill(title);
  await page.getByRole('checkbox', { name: /我确认拥有发布权/ }).check();
  let failures = 1;
  await page.route('**/api/community/revisions/*/submit', async (route) => {
    if (failures-- > 0) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '模拟网络故障' } }) });
    else await route.continue();
  });
  await page.getByRole('button', { name: '冻结快照并提交审核' }).click();
  await expect(page.locator('.community-submit-form').getByRole('alert')).toContainText('草稿已保留');
  await page.getByRole('button', { name: '重试提交审核' }).click();
  await expect(page).toHaveURL(/\/community\/mine$/);
  const item = page.locator('.community-mine-list > li').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('正在等待审核');
  for (const width of [350, 390, 768, 1280, 1440]) await inspect('submissions-mine', width);
  await item.getByRole('button', { name: '撤回本次审核' }).click();
  await inspect('submission-withdraw', 350);
  await page.getByRole('button', { name: '确认撤回' }).click();
  await expect(item.getByRole('link', { name: '修改并重新投稿' })).toBeVisible();
  await item.getByRole('link', { name: '修改并重新投稿' }).click();
  await expect(page.getByLabel('公开作品标题')).toHaveValue('E2E 私人设计');
  await expect(page.getByRole('checkbox', { name: /我确认拥有发布权/ })).not.toBeChecked();
  console.log(JSON.stringify({ submitFailureKeepsOneDraft: true, withdrawalThenRevision: true, licenseAlwaysOptIn: true }));
  await context.close();
} finally { await browser.close(); }
