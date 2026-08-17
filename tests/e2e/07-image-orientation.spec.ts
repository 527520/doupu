import { expect, test, type Locator, type Page } from '@playwright/test';
import { waitHydrated } from './helpers';

async function orientation6Jpeg(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const sourceCanvas = new OffscreenCanvas(30, 20);
    const sourceContext = sourceCanvas.getContext('2d');
    if (!sourceContext) throw new Error('2d context unavailable');
    sourceContext.fillStyle = '#FF0000';
    sourceContext.fillRect(0, 0, 15, 10);
    sourceContext.fillStyle = '#00FF00';
    sourceContext.fillRect(15, 0, 15, 10);
    sourceContext.fillStyle = '#0000FF';
    sourceContext.fillRect(0, 10, 15, 10);
    sourceContext.fillStyle = '#FFFF00';
    sourceContext.fillRect(15, 10, 15, 10);

    const rawJpeg = new Uint8Array(await (
      await sourceCanvas.convertToBlob({ type: 'image/jpeg', quality: 1 })
    ).arrayBuffer());
    // Minimal big-endian Exif APP1 segment: IFD0 Orientation (0x0112) = 6
    // (90 degrees clockwise). Generated at runtime, so no binary fixture is kept.
    const orientation6 = new Uint8Array([
      0xff, 0xe1, 0x00, 0x22,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
      0x00, 0x01,
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]);
    const jpeg = new Uint8Array(rawJpeg.length + orientation6.length);
    jpeg.set(rawJpeg.subarray(0, 2));
    jpeg.set(orientation6, 2);
    jpeg.set(rawJpeg.subarray(2), 2 + orientation6.length);
    return Array.from(jpeg);
  });
  return Buffer.from(bytes);
}

async function sampleVerticalColors(canvas: Locator): Promise<{ top: number[]; bottom: number[] }> {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('2d');
    if (!context) throw new Error('2d context unavailable');
    const sample = (x: number, y: number): number[] => Array.from(
      context.getImageData(
        Math.max(0, Math.min(element.width - 1, Math.floor(element.width * x))),
        Math.max(0, Math.min(element.height - 1, Math.floor(element.height * y))),
        1,
        1,
      ).data.slice(0, 3),
    );
    return { top: sample(0.25, 0.25), bottom: sample(0.25, 0.75) };
  });
}

function expectBlue(rgb: number[]): void {
  expect(rgb[2]).toBeGreaterThan(rgb[0] + 50);
  expect(rgb[2]).toBeGreaterThan(rgb[1] + 50);
}

function expectYellow(rgb: number[]): void {
  expect(rgb[0]).toBeGreaterThan(rgb[2] + 50);
  expect(rgb[1]).toBeGreaterThan(rgb[2] + 50);
}

test('EXIF 旋转 JPEG 通过真实 Workbench Worker 以同一 oriented 坐标预览和裁剪', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.goto('/app');
  await waitHydrated(page);
  const jpeg = await orientation6Jpeg(page);

  await page.getByLabel('图片文件选择器').setInputFiles({
    name: 'orientation-6.jpg',
    mimeType: 'image/jpeg',
    buffer: jpeg,
  });
  await expect(page.getByRole('heading', { name: '裁剪图片' })).toBeVisible();
  await expect(page.getByText('20 × 30 像素')).toBeVisible();

  // Orientation=6 makes the source 20×30. Its oriented left half is blue at
  // the top and yellow at the bottom.
  const previewColors = await sampleVerticalColors(page.getByLabel('裁剪选区画布'));
  expectBlue(previewColors.top);
  expectYellow(previewColors.bottom);

  await page.getByRole('button', { name: '确认裁剪' }).click();
  await expect(page.getByText(/共 15000 粒/).first()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('网格线').uncheck();
  await page.getByLabel('板缝线').uncheck();
  await page.getByLabel('色号标注').uncheck();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const patternColors = await sampleVerticalColors(page.locator('canvas').last());
  expectBlue(patternColors.top);
  expectYellow(patternColors.bottom);
});
