import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uploadFile } from './helpers';

const PHOTO = resolve(process.cwd(), 'tests/fixtures/static-2x2.png');
const at = '2026-08-17T00:00:00.000Z';

function project(width: number, height: number, colors: Array<{ code: string; hex: string }>) {
  return {
    format: 'doupu-project', version: 3, engineVersion: '2.0.0', boardProfile: '5mm-29', name: `极限-${width}x${height}`,
    createdAt: at, updatedAt: at,
    paletteSelection: { palette: { kind: 'custom', colors }, kitTier: 0 },
    params: { targetWidth: Math.max(20, width), targetColorCount: 128, dithering: false, mode: 'dominant', brightness: 0, contrast: 0, backgroundRemoval: false, bgTolerance: 8 },
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

async function importProject(page: Page, value: ReturnType<typeof project>): Promise<void> {
  await page.getByLabel('项目文件选择器').setInputFiles({
    name: 'extreme.doupu.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByRole('textbox', { name: '设计名称' })).toHaveValue(value.name);
}

test('200×1 PNG has cross-browser decodable golden pixels and 500-color PDF paginates', async ({ page }) => {
  await page.goto('/app');
  await uploadFile(page, PHOTO);
  await page.getByRole('button', { name: '确认裁剪' }).click();
  await expect(page.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });

  const pngProject = project(200, 1, [
    { code: 'RED-LONG-CODE-000001', hex: '#FF0000' },
    { code: 'BLUE-LONG-CODE-00002', hex: '#0000FF' },
  ]);
  await importProject(page, pngProject);
  await page.getByRole('button', { name: /导出 PNG/ }).click();
  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出', exact: true }).click(),
  ]);
  const pngBytes = readFileSync((await pngDownload.path())!);
  const decoded = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    // WebKit（Playwright）没有 OffscreenCanvas，这里用普通 canvas 元素。
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    // Sample inside the first/last cell but above the centred colour-code text.
    // This keeps the assertion pixel-exact while still exercising long labels.
    const first = [...context.getImageData(12, 2, 1, 1).data];
    const last = [...context.getImageData(canvas.width - 12, 2, 1, 1).data];
    return { width: canvas.width, height: canvas.height, first, last };
  }, pngBytes.toString('base64'));
  expect(decoded).toEqual({
    width: 4800,
    height: 24,
    first: [255, 0, 0, 255],
    last: [0, 0, 255, 255],
  });

  const colors500 = Array.from({ length: 500 }, (_, index) => ({
    code: `C${String(index + 1).padStart(4, '0')}-LONG`,
    hex: `#${String(index + 1).padStart(6, '0')}`,
  }));
  await importProject(page, project(25, 20, colors500));
  await page.getByRole('button', { name: /导出 PDF/ }).click();
  await expect(page.getByText(/图纸 \d+ 页.*图例清单 \d+ 页/)).toBeVisible();
  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出', exact: true }).click(),
  ]);
  const pdf = await PDFDocument.load(readFileSync((await pdfDownload.path())!));
  expect(pdf.getPageCount()).toBeGreaterThan(2);
});
