/**
 * 编辑/跟拼有界画布的真实浏览器回归：
 * - 手机工作区是同路由沉浸层，浏览器 Back 只退回预览；
 * - 200×200 图纸的 Canvas 后备缓冲区仍以视窗而非整图分配；
 * - Playwright 的 iPhone / Pixel 设备模拟都能落笔；跟拼触摸拖动零写入，短点可标记且可撤销；
 * - 三浏览器桌面 944/1280/1440px 下编辑与跟拼都不会撑宽页面。
 */
import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { BASE_URL, uploadFile } from './helpers';

const PHOTO = resolve(process.cwd(), 'tests/fixtures/static-2x2.png');
const FIXED_TIME = '2026-08-30T00:00:00.000Z';

function project(width: number, height: number) {
  const colors = [
    { code: 'A01', hex: '#F35B78' },
    { code: 'B02', hex: '#6752A3' },
  ];
  return {
    format: 'doupu-project',
    version: 3,
    engineVersion: '2.0.0',
    boardProfile: '5mm-29',
    name: `有界画布-${width}x${height}`,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    paletteSelection: { palette: { kind: 'custom', colors }, kitTier: 0 },
    params: {
      targetWidth: width,
      targetColorCount: colors.length,
      dithering: false,
      mode: 'dominant',
      brightness: 0,
      contrast: 0,
      backgroundRemoval: false,
      bgTolerance: 8,
    },
    pattern: {
      width,
      height,
      cells: Array.from({ length: width * height }, (_, index) => ({
        ...colors[index % colors.length],
        transparent: false,
      })),
    },
  };
}

async function importProject(page: Page, width: number, height: number): Promise<void> {
  const value = project(width, height);
  await page.getByLabel('项目文件选择器').setInputFiles({
    name: 'bounded-canvas.doupu.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByRole('textbox', { name: '设计名称' }).last()).toHaveValue(value.name);
  await expect(page.getByText(`共 ${width * height} 粒`).first()).toBeVisible();
}

async function enterWorkbenchWithProject(page: Page, width = 200, height = 200): Promise<void> {
  await page.goto('/app');
  await uploadFile(page, PHOTO);
  await page.getByRole('button', { name: '使用整张图片' }).click();
  await expect(page.getByRole('status').filter({ hasText: '图纸已生成' })).toBeVisible({ timeout: 20_000 });

  // 移动布局把项目文件入口放在「导出」抽屉；桌面入口始终存在。
  const exportTools = page.getByRole('button', { name: '导出', exact: true });
  if (await exportTools.isVisible().catch(() => false)) await exportTools.click();
  await importProject(page, width, height);
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowers: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: typeof element.className === 'string' ? element.className : '',
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          display: style.display,
          minWidth: style.minWidth,
          overflowX: style.overflowX,
          flexShrink: style.flexShrink,
        };
      })
      .filter((entry) => entry.right > document.documentElement.clientWidth + 0.5)
      .slice(0, 20),
  }));
  expect(
    dimensions.scrollWidth,
    `横向越界节点：${JSON.stringify(dimensions.overflowers, null, 2)}`,
  ).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectViewportSizedBacking(canvas: Locator, page: Page): Promise<void> {
  await expect(canvas).toBeVisible();
  const geometry = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const rect = target.getBoundingClientRect();
    return {
      cssWidth: rect.width,
      cssHeight: rect.height,
      backingWidth: target.width,
      backingHeight: target.height,
      dpr: window.devicePixelRatio,
    };
  });
  expect(geometry.cssWidth).toBeGreaterThan(0);
  expect(geometry.cssHeight).toBeGreaterThan(0);
  // 绘制层把高 DPR 设备限制为 2，避免手机创建过大的后备缓冲区。
  const renderDpr = Math.min(2, geometry.dpr);
  // ResizeObserver 与绘制 effect 可能相差一帧，给浮点取整留 4px 余量。
  expect(Math.abs(geometry.backingWidth - Math.floor(geometry.cssWidth * renderDpr))).toBeLessThanOrEqual(4);
  expect(Math.abs(geometry.backingHeight - Math.floor(geometry.cssHeight * renderDpr))).toBeLessThanOrEqual(4);
  // 200×200 若按最低 20 CSS px/格分配会至少达到 4000×4000；这里必须明显小于整图。
  expect(geometry.backingWidth).toBeLessThan(4000 * geometry.dpr);
  expect(geometry.backingHeight).toBeLessThan(4000 * geometry.dpr);
  expect(geometry.backingWidth).toBeLessThanOrEqual(await page.evaluate(() => Math.ceil(innerWidth * devicePixelRatio) + 4));
}

async function dispatchTouchDrag(canvas: Locator): Promise<void> {
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width * 0.45, y: box!.y + box!.height * 0.45 };
  const end = { x: start.x + Math.min(70, box!.width * 0.25), y: start.y + 45 };
  await canvas.dispatchEvent('pointerdown', {
    pointerId: 71,
    pointerType: 'touch',
    isPrimary: true,
    buttons: 1,
    clientX: start.x,
    clientY: start.y,
  });
  await canvas.dispatchEvent('pointermove', {
    pointerId: 71,
    pointerType: 'touch',
    isPrimary: true,
    buttons: 1,
    clientX: end.x,
    clientY: end.y,
  });
  await canvas.dispatchEvent('pointerup', {
    pointerId: 71,
    pointerType: 'touch',
    isPrimary: true,
    buttons: 0,
    clientX: end.x,
    clientY: end.y,
  });
}

async function tapCanvasOffset(page: Page, canvas: Locator, xOffset = 0): Promise<void> {
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2 + xOffset, box!.y + box!.height / 2);
}

async function exerciseMobileWorkspace(page: Page): Promise<void> {
  await enterWorkbenchWithProject(page);
  await expectNoDocumentOverflow(page);

  const previewTab = page.getByRole('tab', { name: '预览', exact: true });
  await previewTab.click();
  await page.getByRole('tab', { name: '编辑', exact: true }).click();

  const workspace = page.getByTestId('mobile-immersive-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace).toHaveCSS('position', 'fixed');
  const editCanvas = page.getByLabel('图纸编辑画布');
  await expectViewportSizedBacking(editCanvas, page);
  await expectNoDocumentOverflow(page);

  // 手机默认手形。切换画笔会进入可编辑比例；缩放按钮再放大一级。
  const editor = workspace.locator('.pixel-editor-studio');
  const editorUndo = editor.getByRole('button', { name: '撤销', exact: true });
  await expect(editorUndo).toBeDisabled();
  await editor.getByRole('button', { name: '画笔', exact: true }).click();
  const cellSize = editor.getByLabel('当前格子大小');
  await expect(cellSize).toHaveText('20px');
  await editor.getByRole('button', { name: '放大画布' }).click();
  await expect(cellSize).toHaveText('25px');
  // 200×200 图纸中心为 A01，右侧相邻格为 B02；画笔当前色为 A01，因此会产生真实改动。
  await tapCanvasOffset(page, editCanvas, 25);
  await expect(editorUndo).toBeEnabled();

  // 沉浸层内切换使用 replaceState，最终一次 Back 仍只退回普通预览。
  await workspace.getByRole('tab', { name: '跟拼', exact: true }).click();
  await expect(workspace).toBeVisible();
  const stitchCanvas = page.getByRole('img', { name: /跟拼画布：200 × 200 格/ });
  await expectViewportSizedBacking(stitchCanvas, page);
  const progress = page.getByText(/^已拼 \d+ \/ \d+ 粒/).first();
  await expect(progress).toContainText('已拼 0 / 40000 粒');
  const before = await progress.textContent();
  await dispatchTouchDrag(stitchCanvas);
  await expect(progress).toHaveText(before!);
  await expectNoDocumentOverflow(page);

  // 明确切到标记模式后，短点成功标一格；会话历史可立即撤销。
  const stitch = workspace.locator('.stitch-studio');
  await stitch.getByRole('button', { name: '标记', exact: true }).click();
  await tapCanvasOffset(page, stitchCanvas);
  await expect(progress).toContainText('已拼 1 / 40000 粒');
  const stitchUndo = stitch.getByRole('button', { name: '撤销', exact: true });
  await expect(stitchUndo).toBeEnabled();
  await stitchUndo.click();
  await expect(progress).toContainText('已拼 0 / 40000 粒');
  await expect(stitchUndo).toBeDisabled();

  // 同一路由压入一层界面状态：浏览器返回只退出工作区，不离开 /app。
  await page.goBack();
  await expect(workspace).toBeHidden();
  await expect(previewTab).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).pathname).toBe('/app');
}

test('[设备模拟] iPhone 13 390×844 可绘制、跟拼标记/撤销并安全返回', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit');
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
    baseURL: BASE_URL,
  });
  try {
    const page = await context.newPage();
    await exerciseMobileWorkspace(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  } finally {
    await context.close();
  }
});

test('[设备模拟] Pixel 7 412×915 可绘制、跟拼标记/撤销并安全返回', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    viewport: { width: 412, height: 915 },
    baseURL: BASE_URL,
  });
  try {
    const page = await context.newPage();
    await exerciseMobileWorkspace(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  } finally {
    await context.close();
  }
});

test('29×29、58×58、100×63 在桌面 944/1280/1440px 保持有界且不撑宽页面', async ({ page }) => {
  await page.setViewportSize({ width: 944, height: 800 });
  await enterWorkbenchWithProject(page, 29, 29);

  for (const [width, patternWidth, patternHeight] of [
    [944, 29, 29],
    [1280, 58, 58],
    [1440, 100, 63],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    if (patternWidth !== 29 || patternHeight !== 29) {
      await importProject(page, patternWidth, patternHeight);
    }
    await page.getByRole('tab', { name: '编辑', exact: true }).click();
    await expectViewportSizedBacking(page.getByLabel('图纸编辑画布'), page);
    await expectNoDocumentOverflow(page);

    await page.getByRole('tab', { name: '跟拼', exact: true }).click();
    await expectViewportSizedBacking(
      page.getByRole('img', { name: new RegExp(`跟拼画布：${patternWidth} × ${patternHeight} 格`) }),
      page,
    );
    await expectNoDocumentOverflow(page);
  }
});
