import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import {
  BASE_URL,
  fillField,
  uniqueEmail,
  uploadFile,
  waitForMailLink,
  waitHydrated,
} from './helpers';

const widths = [350, 390, 768, 944, 1180, 1280, 1440] as const;
const PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png');

async function registerAndLogin(page: Page): Promise<string> {
  const email = uniqueEmail('responsive');
  const password = 'responsive-password-123';
  await page.goto('/register');
  await fillField(page, '邮箱', email);
  await fillField(page, '密码', password);
  await fillField(page, '确认密码', password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page.getByText(/验证邮件已发送/).first()).toBeVisible({ timeout: 15_000 });
  await page.goto(await waitForMailLink('verify', email));
  await expect(page.getByText(/邮箱验证成功/).first()).toBeVisible({ timeout: 10_000 });
  await page.goto('/login');
  await fillField(page, '邮箱', email);
  await fillField(page, '密码', password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/\/designs|\/app/, { timeout: 15_000 });
  return email;
}

async function assertProjectBarLayout(
  page: Page,
  projectBar: Locator,
  width: number,
  expectedLeafCount: number,
): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));

  const geometry = await projectBar.evaluate((bar) => {
    const candidates: Array<[string, Element | null]> = [
      ['name', bar.querySelector('input[aria-label="设计名称"]')],
      ['palette', bar.querySelector('.workspace-palette-summary')],
      ...Array.from(bar.querySelectorAll('.workbench-save-actions [role="status"], .workbench-save-actions button'))
        .map((element, index): [string, Element] => [`save-${index}`, element]),
      ['overflow', bar.querySelector('.workspace-project-actions > .workspace-overflow > button')],
    ];
    const visible = candidates.flatMap(([name, element]) => {
      if (!(element instanceof HTMLElement)) return [];
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return [];
      return [{ name, rect }];
    });
    const rects = visible.map(({ rect }) => rect);
    const intersects = rects.some((first, firstIndex) => rects
      .slice(firstIndex + 1)
      .some((second) => first.left < second.right
        && first.right > second.left
        && first.top < second.bottom
        && first.bottom > second.top));
    return {
      count: rects.length,
      visibleNames: visible.map(({ name }) => name),
      intersects,
      left: Math.min(...rects.map((rect) => rect.left)),
      right: Math.max(...rects.map((rect) => rect.right)),
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });

  expect(geometry.count, `${width}px 项目操作栏应完整显示：${geometry.visibleNames.join(', ')}`).toBe(expectedLeafCount);
  expect(geometry.intersects, `${width}px 名称、色板、保存状态与操作不得重叠`).toBe(false);
  expect(geometry.left, `${width}px 工作区操作不得越出视口左侧`).toBeGreaterThanOrEqual(0);
  expect(geometry.right, `${width}px 工作区操作不得越出视口`).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.documentWidth, `${width}px 页面不得产生横向滚动`).toBeLessThanOrEqual(geometry.viewportWidth);
}

for (const width of widths) {
  test(`工作台 ${width}px 无横向溢出且关键操作可见`, async ({ page }) => {
    const consoleErrors: Array<{ text: string; url: string }> = [];
    const expectedAnonymousResponses = new Set<string>();
    // 界面子集字体源文件不入库（见 NOTICE.md 与 scripts/build-ui-font-subset.mjs），
    // CI/未跑 prebuild 的环境里 @font-face 会 404 并回退系统字体——这是刻意支持的状态，
    // 不计入控制台错误。
    const toleratedConsole = /ui-sans-sc\.subset\.ttf/;
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
      } else if (response.status() >= 400 && !toleratedConsole.test(response.url())) {
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
        (error) => !expectedAnonymousResponses.has(error.url)
          && !toleratedConsole.test(error.text)
          && !toleratedConsole.test(error.url),
      );
      const errors = [
        ...httpErrors,
        ...unexpectedConsoleErrors.map(({ text, url }) => `${text}${url ? ` (${url})` : ''}`),
      ];
      expect(errors, errors.join('\n')).toEqual([]);
      const mobileNav = page.getByTestId('workspace-mobile-nav');
      await expect(mobileNav.getByRole('link', { name: '设计' })).toBeVisible();
      await expect(mobileNav.getByRole('link', { name: '我的' })).toBeVisible();
    }
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  });
}

test('桌面设计库与色板页不被固定侧栏撑出视口', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');

  for (const width of [944, 1280, 1440] as const) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of ['/designs', '/palettes'] as const) {
      await page.goto(route);
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
      }));
      expect(dimensions.page, `${route} 在 ${width}px 下不得横向溢出`).toBeLessThanOrEqual(dimensions.viewport);
    }
  }
});

test('工作区项目操作栏在游客与登录态的全部目标宽度下不重叠', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: widths[0], height: 800 });
  await page.goto('/app');
  await uploadFile(page, PHOTO);
  await page.getByRole('button', { name: '使用整张图片' }).click();
  let projectBar = page.getByRole('region', { name: '当前设计操作' });
  await expect(projectBar.getByLabel('设计名称')).toBeVisible({ timeout: 20_000 });
  await expect(projectBar.getByText('设计名称', { exact: true })).toBeVisible();
  await expect(projectBar.locator('.workspace-palette-summary')).toBeVisible();

  for (const width of widths) {
    await assertProjectBarLayout(page, projectBar, width, 5);
    await expect(projectBar.getByRole('button', { name: '保存', exact: true })).toBeVisible();
    const more = projectBar.getByRole('button', { name: '更多操作' });
    await more.click();
    const overflowPanel = projectBar.getByTestId('site-overflow-panel');
    await expect(overflowPanel).toBeVisible();
    const overflowGeometry = await overflowPanel.evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      const actionHeights = Array.from(panel.querySelectorAll('a, button'))
        .map((element) => element.getBoundingClientRect().height);
      return {
        left: rect.left,
        right: rect.right,
        viewportWidth: document.documentElement.clientWidth,
        actionHeights,
      };
    });
    expect(overflowGeometry.left, `${width}px 游客菜单不得越出视口左侧`).toBeGreaterThanOrEqual(0);
    expect(overflowGeometry.right, `${width}px 游客菜单不得越出视口右侧`).toBeLessThanOrEqual(overflowGeometry.viewportWidth);
    expect(
      overflowGeometry.actionHeights.every((height) => height >= 44),
      `${width}px 游客菜单点击目标不得小于 44px`,
    ).toBe(true);
    await more.click();
  }

  await projectBar.getByRole('button', { name: '保存', exact: true }).click();
  await expect(projectBar.getByRole('status').filter({ hasText: /已保存/ })).toBeVisible({ timeout: 15_000 });
  const email = await registerAndLogin(page);
  await page.goto('/app');
  projectBar = page.getByRole('region', { name: '当前设计操作' });
  await expect(projectBar.getByLabel('设计名称')).toBeVisible({ timeout: 20_000 });
  await expect(projectBar.getByText('设计名称', { exact: true })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  await expect(projectBar.getByRole('button', { name: '重新上传', exact: true })).toBeVisible();
  await expect(projectBar.getByText(/云端：/)).toBeVisible();

  for (const width of widths) {
    await assertProjectBarLayout(page, projectBar, width, 6);
  }
});

test('移动工作台可切换编辑、用色与导出工具', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await uploadFile(page, PHOTO);
  await page.getByRole('button', { name: '使用整张图片' }).click();

  await expect(page.getByLabel('设计名称').last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: '图纸已生成' })).toBeVisible();
  await expect(page.locator('#panel-preview')).toBeFocused();
  await page.getByRole('tab', { name: '预览', exact: true }).focus();
  await page.getByRole('tab', { name: '预览', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: '编辑', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('图纸编辑画布')).toBeVisible();

  // 编辑/跟拼现在是沉浸工作区：先验证编辑器自己的「更多」抽屉，
  // 再返回普通预览操作页面级的用色与导出工具。
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await expect(page.getByRole('button', { name: '油漆桶', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回预览', exact: true }).click();
  await expect(page.locator('#panel-preview')).toBeVisible();

  const colors = page.getByRole('button', { name: '用色', exact: true });
  await colors.click();
  await expect(colors).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mobile-tool-sheet').getByText(/共 \d+ 粒/).first()).toBeVisible();

  const exportTools = page.getByRole('button', { name: '导出', exact: true });
  await exportTools.click();
  await expect(exportTools).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '导出 PNG 图纸' })).toBeVisible();
});

for (const route of ['/', '/app', '/designs', '/palettes', '/account', '/help', '/about'] as const) {
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
