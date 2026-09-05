import { chromium, firefox, webkit, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ baseURL: 'https://127.0.0.1:3443', ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/app?new=1');
    await page.getByRole('button', { name: '拒绝', exact: true }).click();
    await page.getByLabel('图片文件选择器').setInputFiles(resolve('tests/fixtures/static-2x2.png'));
    await expect(page.getByRole('status').filter({ hasText: '图纸已生成' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('本地：已保存', { exact: true }).first()).toBeVisible();
    // Reopen the saved design via the same navigation users get from recent tasks.
    await page.goto('/designs');
    const design = page.locator('.design-card').first();
    await expect(design).toBeVisible();
    await design.getByRole('button', { name: /继续/ }).first().click();
    await expect(page).toHaveURL(/\/app\?id=/);
    const direct = new URL(page.url()); direct.searchParams.set('mode', 'stitch');
    await page.goto(direct.toString());
    const dialog = page.getByTestId('mobile-immersive-workspace');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /返回预览/ })).toBeFocused();
    expect(await page.locator('.workspace-content').evaluate((node) => Boolean(node.closest('[inert]')))).toBe(true);
    for (let count = 0; count < 35; count++) {
      await page.keyboard.press(count % 2 ? 'Shift+Tab' : 'Tab');
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => ['serious', 'critical'].includes(item.impact))).toEqual([]);
    await page.screenshot({ path: resolve(`.scratch/site-ux/direct-stitch-${name}-390.png`) });
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    expect(await page.locator('.workspace-content').evaluate((node) => Boolean(node.closest('[inert]')))).toBe(false);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    console.log(JSON.stringify({ browser: name, directStitchFocus: true, backgroundInert: true, focusLoop: true, escapeAndScrollRestore: true, seriousAxe: 0 }));
    await context.close();
  } finally { await browser.close(); }
}
