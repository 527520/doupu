/**
 * E2E 边界用例：上传校验（spec §6 E1–E13 的可浏览器断言部分）。
 * 注意：截断 PNG 的处理存在浏览器差异（Firefox 容忍、Chromium/WebKit 报错），
 * 两种结果都是可接受的合法处理。
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { uploadFile } from './helpers';

const fixture = (name: string) => resolve(process.cwd(), 'tests/fixtures', name);

async function openApp(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/app');
  await page.getByLabel('图片文件选择器').waitFor();
}

test('E4：动画 GIF 拒绝', async ({ page }) => {
  await openApp(page);
  await uploadFile(page, fixture('animated-2frames.gif'));
  await expect(page.getByText(/不支持动图/).first()).toBeVisible({ timeout: 10_000 });
});

test('E3：改名文本文件按内容嗅探拒绝', async ({ page }) => {
  await openApp(page);
  await uploadFile(page, fixture('text-as-photo.jpg'));
  await expect(page.getByText(/不支持的图片格式/).first()).toBeVisible({ timeout: 10_000 });
});

test('E2：截断 PNG —— 报解码错误或浏览器容忍生成预览，两者皆合法', async ({ page }) => {
  await openApp(page);
  await uploadFile(page, fixture('truncated.png'));
  const decodeError = page.getByText(/无法解析该图片/).first();
  const cropScreen = page.getByRole('button', { name: '裁剪图片', exact: true });
  await expect(decodeError.or(cropScreen).first()).toBeVisible({ timeout: 10_000 });
});

test('E10：全透明 PNG 生成后统计为 0 且 PNG 导出禁用', async ({ page }) => {
  await openApp(page);
  await uploadFile(page, fixture('transparent-64.png'));
  await expect(page.getByText(/共 0 粒/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /导出 PNG/ })).toBeDisabled();
});

test('损坏 HEIC：尺寸探针失败时在原生/WASM 解码前拒绝', async ({ page }) => {
  await openApp(page);
  await uploadFile(page, fixture('fake.heic'));
  await expect(page.getByText('无法解析该图片，文件可能已损坏。')).toBeVisible();
});

test('真实 HEIC：原生或 WASM 路径都必须自动生成首版', async ({ page }) => {
  await openApp(page);
  await uploadFile(page, fixture('static-real.heic'));
  await expect(page.getByRole('button', { name: '裁剪图片', exact: true })).toBeEnabled({ timeout: 30_000 });
});

test('最大合法 8000×8000 与极端 100×8000 输入使用有界预览并可完成生成', async ({ page }, testInfo) => {
  await openApp(page);
  if (testInfo.project.name === 'chromium') {
    await page.evaluate(() => {
      const entries: Array<{ startTime: number; duration: number }> = [];
      const marks: Array<{ name: string; at: number }> = [];
      const observer = new PerformanceObserver((list) => {
        entries.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })));
      });
      Object.assign(window, {
        __doupuLongTasks: entries,
        __doupuPerfMarks: marks,
        __doupuLongTaskObserver: observer,
      });
      observer.observe({ type: 'longtask' });
    });
  }
  const mark = async (name: string): Promise<void> => {
    if (testInfo.project.name !== 'chromium') return;
    await page.evaluate((label) => {
      (window as Window & { __doupuPerfMarks?: Array<{ name: string; at: number }> })
        .__doupuPerfMarks?.push({ name: label, at: performance.now() });
    }, name);
  };
  await mark('square-upload-start');
  await uploadFile(page, fixture('max-8000-square.png'));
  await page.getByRole('button', { name: '裁剪图片', exact: true }).click();
  await expect(page.getByRole('heading', { name: '裁剪图片' })).toBeVisible({ timeout: 30_000 });
  await mark('square-crop-visible');
  const squarePreview = page.getByLabel('裁剪选区画布');
  // CSS 预览尺寸 ≤ 800：容器未测出前高度为 auto（随夹取宽度按固有比例算高），
  // 此时高度 NaN 按「不高于宽度」处理；画布缓冲上界由下一行断言兜底。
  const previewCssMax = (canvas: HTMLCanvasElement): number => {
    const w = Number.parseFloat(canvas.style.width);
    const h = Number.parseFloat(canvas.style.height);
    return Number.isNaN(h) ? w : Math.max(w, h);
  };
  expect(await squarePreview.evaluate(previewCssMax)).toBeLessThanOrEqual(800);
  expect(await squarePreview.evaluate((canvas: HTMLCanvasElement) => Math.max(canvas.width, canvas.height)))
    .toBeLessThanOrEqual(await page.evaluate(() => 800 * (window.devicePixelRatio || 1)));
  await page.getByRole('button', { name: '确认并更新' }).click();
  await expect(page.getByText(/共 10000 粒/).first()).toBeVisible({ timeout: 30_000 });
  await mark('square-generated');

  // 游客的「重新上传」留在顶栏溢出面板，先展开再点击。
  await page.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('button', { name: '重新上传' }).click();
  await mark('tall-upload-start');
  await uploadFile(page, fixture('max-100x8000.png'));
  await page.getByRole('button', { name: '裁剪图片', exact: true }).click();
  await expect(page.getByRole('heading', { name: '裁剪图片' })).toBeVisible({ timeout: 30_000 });
  await mark('tall-crop-visible');
  const tallPreview = page.getByLabel('裁剪选区画布');
  expect(await tallPreview.evaluate(previewCssMax)).toBeLessThanOrEqual(800);
  expect(await tallPreview.evaluate((canvas: HTMLCanvasElement) => Math.max(canvas.width, canvas.height)))
    .toBeLessThanOrEqual(await page.evaluate(() => 800 * (window.devicePixelRatio || 1)));
  await page.getByRole('button', { name: '确认并更新' }).click();
  await expect(page.getByText(/共 20000 粒/).first()).toBeVisible({ timeout: 30_000 });
  await mark('tall-generated');
  if (testInfo.project.name === 'chromium') {
    const performanceLog = await page.evaluate(() => {
      const measuredWindow = window as Window & {
        __doupuLongTasks?: Array<{ startTime: number; duration: number }>;
        __doupuPerfMarks?: Array<{ name: string; at: number }>;
        __doupuLongTaskObserver?: PerformanceObserver;
      };
      const observer = measuredWindow.__doupuLongTaskObserver;
      measuredWindow.__doupuLongTasks?.push(...(observer?.takeRecords() ?? []).map((entry) => ({
        startTime: entry.startTime,
        duration: entry.duration,
      })));
      observer?.disconnect();
      return {
        longTasks: measuredWindow.__doupuLongTasks ?? [],
        marks: measuredWindow.__doupuPerfMarks ?? [],
      };
    });
    expect(performanceLog.longTasks, `main-thread performance: ${JSON.stringify(performanceLog)}`).toEqual([]);
  }
});
