import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { BASE_URL, uploadFile, waitHydrated } from './helpers';

const widths = [350, 390, 768, 944, 1180, 1280, 1440] as const;
const PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png');

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
    // 不得带 capture：移动端浏览器一旦带 capture 只允许调用摄像头，相册选择被堵死
    // （0.3.0 真机验收抓到的回归，模拟器发现不了）。
    await expect(page.getByLabel('图片文件选择器')).not.toHaveAttribute('capture');
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

test('工作区页头在全部目标宽度下导航行与设计操作行不相交', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: widths[0], height: 800 });
  await page.goto('/app');
  await uploadFile(page, PHOTO);
  await page.getByRole('button', { name: '使用整张图片' }).click();
  const designName = page.getByLabel('设计名称').first();
  const save = page.getByRole('button', { name: '保存', exact: true });
  await expect(designName).toBeVisible({ timeout: 20_000 });

  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));

    const geometry = await page.locator('header').evaluate((header) => {
      const visibleRect = (element: Element | null): DOMRect | null => {
        if (!(element instanceof HTMLElement) || element.offsetParent === null) return null;
        return element.getBoundingClientRect();
      };
      const topRow = [
        visibleRect(header.querySelector('h1')),
        ...Array.from(header.querySelectorAll('nav[aria-label="主导航"]')).map(visibleRect),
        visibleRect(header.querySelector('button[aria-controls="site-overflow-panel"]')),
      ].filter((rect): rect is DOMRect => rect !== null);
      const workspaceRow = [
        visibleRect(header.querySelector('input[aria-label="设计名称"]')),
        ...Array.from(header.querySelectorAll('[role="status"]')).map(visibleRect),
        visibleRect(Array.from(header.querySelectorAll('button')).find((button) => button.textContent?.trim() === '保存') ?? null),
      ].filter((rect): rect is DOMRect => rect !== null);
      const intersections = workspaceRow.flatMap((first, firstIndex) => workspaceRow
        .slice(firstIndex + 1)
        .map((second) => first.left < second.right
          && first.right > second.left
          && first.top < second.bottom
          && first.bottom > second.top));
      return {
        topBottom: Math.max(...topRow.map((rect) => rect.bottom)),
        workspaceTop: Math.min(...workspaceRow.map((rect) => rect.top)),
        workspaceIntersects: intersections.some(Boolean),
        workspaceRight: Math.max(...workspaceRow.map((rect) => rect.right)),
        headerRight: header.getBoundingClientRect().right,
        viewportWidth: document.documentElement.clientWidth,
      };
    });

    expect(geometry.workspaceTop, `${width}px 工作区操作应位于导航行下方`).toBeGreaterThanOrEqual(geometry.topBottom);
    expect(geometry.workspaceIntersects, `${width}px 名称、状态和保存按钮不得重叠`).toBe(false);
    expect(geometry.workspaceRight, `${width}px 工作区操作不得越出页头`).toBeLessThanOrEqual(geometry.headerRight);
    expect(geometry.headerRight, `${width}px 页头不应越出视口`).toBeLessThanOrEqual(geometry.viewportWidth);
    await expect(save).toBeVisible();
  }
});

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
  // 不得带 capture（见上方说明）：手机上必须能选相册，相机入口由系统选择器提供。
  await expect(page.getByLabel('图片文件选择器')).not.toHaveAttribute('capture');
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
  // 不得带 capture（见上方说明）：手机上必须能选相册，相机入口由系统选择器提供。
  await expect(page.getByLabel('图片文件选择器')).not.toHaveAttribute('capture');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  await context.close();
});
