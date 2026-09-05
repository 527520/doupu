import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3109' });
  const page = await context.newPage();
  await page.goto('/app?new=1');
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await page.getByLabel('图片文件选择器').setInputFiles(resolve('tests/fixtures/photo-wide-320x200.png'));
  await expect(page.getByText(/共 6300 粒/).first()).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('本地：已保存', { exact: true }).first()).toBeVisible();
  const inspect = async (name, width) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
    await page.screenshot({ path: resolve(`.scratch/site-ux/${name}-${width}.png`), fullPage: true });
    console.log(JSON.stringify({ name, width, noOverflow: true, seriousAxe: 0 }));
  };
  for (const width of [350, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await inspect('workbench', width);
  }
  await page.reload();
  await expect(page.getByRole('tab', { name: '预览', exact: true })).toBeVisible();
  await expect(page.getByText('当前会话没有完整原图；重新裁剪需要重新选择图片。')).toHaveCount(0);
  await page.getByRole('button', { name: '裁剪图片', exact: true }).click();
  await expect(page.getByText('当前会话没有完整原图；重新裁剪需要重新选择图片。')).toBeVisible();
  await page.getByRole('button', { name: '裁剪图片', exact: true }).click();
  for (const width of [350, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('tab', { name: '编辑', exact: true }).click();
    await expect(page.getByTestId('mobile-immersive-workspace')).toBeVisible();
    await inspect('edit', width);
    await page.getByTestId('mobile-immersive-workspace').getByRole('tab', { name: '跟拼', exact: true }).click();
    await inspect('stitch', width);
    await page.getByTestId('mobile-immersive-workspace').getByRole('button', { name: '返回预览', exact: true }).click();
  }
  await context.close();
} finally { await browser.close(); }
