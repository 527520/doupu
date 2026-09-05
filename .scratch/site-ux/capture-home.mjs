import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3109' });
  const page = await context.newPage();
  await page.goto('/app?new=1');
  await page.getByLabel('图片文件选择器').setInputFiles(resolve('tests/fixtures/photo-wide-320x200.png'));
  await expect(page.getByText(/共 6300 粒/).first()).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('本地：已保存', { exact: true }).first()).toBeVisible({ timeout: 15000 });
  await page.goto('/');
  await expect(page.getByRole('link', { name: /继续制作：/ }).first()).toBeVisible();
  for (const width of [350, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
    await page.screenshot({ path: resolve(`.scratch/site-ux/home-${width}.png`), fullPage: true });
    console.log(JSON.stringify({ width, noOverflow: true, seriousAxe: 0 }));
  }
  await page.getByRole('link', { name: /继续制作：/ }).first().click();
  await expect(page).toHaveURL(/\/app\?id=.+&mode=edit/);
  await expect(page.getByRole('tab', { name: '编辑', exact: true })).toHaveAttribute('aria-selected', 'true');
  console.log(JSON.stringify({ resumeClicks: 1, exactDesignEdit: true }));
  await page.goto('/designs');
  const card = page.getByRole('button', { name: /继续制作：/ }).first();
  await expect(card).toBeEnabled();
  for (const width of [350, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
    await page.screenshot({ path: resolve(`.scratch/site-ux/designs-${width}.png`), fullPage: true });
    console.log(JSON.stringify({ route: '/designs', width, noOverflow: true, seriousAxe: 0 }));
  }
  await page.getByRole('button', { name: /管理：/ }).first().click();
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: /管理：/ }).first()).toBeFocused();
  await card.click();
  await expect(page).toHaveURL(/\/app\?id=.+&mode=edit/);
  await expect(page.getByRole('tab', { name: '编辑', exact: true })).toHaveAttribute('aria-selected', 'true');
  console.log(JSON.stringify({ designCardClicks: 1, exactDesignEdit: true, modalFocusRestored: true }));
  await context.close();
} finally { await browser.close(); }
