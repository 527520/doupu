import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test } from '@playwright/test';
import { BASE_URL, waitHydrated } from './helpers';

const widths = [350, 390, 768, 1280, 1440] as const;

for (const width of widths) {
  test(`工作台 ${width}px 无横向溢出且关键操作可见`, async ({ page }) => {
    const consoleErrors: Array<{ text: string; url: string }> = [];
    const expectedAnonymousResponses = new Set<string>();
    const httpErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push({ text: message.text(), url: message.location().url });
      }
    });
    page.on('response', (response) => {
      const { pathname } = new URL(response.url());
      if (response.status() === 401 && pathname === '/api/auth/me') {
        expectedAnonymousResponses.add(response.url());
      } else if (response.status() >= 400) {
        httpErrors.push(`${response.status()} ${response.url()}`);
      }
    });
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/app');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('button', { name: '选择图片文件' })).toBeVisible();
    await expect(page.getByLabel('图片文件选择器')).toHaveAttribute('capture', 'environment');
    if (width < 768) {
      await page.waitForLoadState('networkidle');
      const unexpectedConsoleErrors = consoleErrors.filter(
        (error) => !expectedAnonymousResponses.has(error.url),
      );
      const errors = [
        ...httpErrors,
        ...unexpectedConsoleErrors.map(({ text, url }) => `${text}${url ? ` (${url})` : ''}`),
      ];
      expect(errors, errors.join('\n')).toEqual([]);
      await page.getByRole('button', { name: '菜单与账户' }).click();
      await expect(page.getByRole('button', { name: '菜单与账户' })).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('site-overflow-panel').getByRole('link', { name: '我的设计' })).toBeVisible();
    }
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  });
}

for (const route of ['/', '/app', '/designs', '/palettes', '/help', '/about'] as const) {
  test(`${route} 无 axe 严重或关键问题`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    // WebKit can replace the execution context while Next's development
    // runtime finishes hydrating. Inject axe only after the app is stable.
    await waitHydrated(page);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}

test('iOS Safari 触屏环境可上传且页面可滚动', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit');
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const response = await page.goto(`${BASE_URL}/app`);
  expect(response?.status(), await page.locator('body').innerText()).toBe(200);
  await expect(page.getByRole('button', { name: '选择图片文件' })).toBeVisible();
  await expect(page.getByLabel('图片文件选择器')).toHaveAttribute('capture', 'environment');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  await context.close();
});

test('Android Chrome 触屏环境可上传且页面可滚动', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const response = await page.goto(`${BASE_URL}/app`);
  expect(response?.status(), await page.locator('body').innerText()).toBe(200);
  await expect(page.getByRole('button', { name: '选择图片文件' })).toBeVisible();
  await expect(page.getByLabel('图片文件选择器')).toHaveAttribute('capture', 'environment');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  await context.close();
});
