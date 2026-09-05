import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { uploadFile, selectChoice } from './helpers';

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
  await page.getByRole('navigation', { name: '工作台工具' }).getByRole('button', { name: '导出', exact: true }).click();
  await page.getByLabel('项目文件选择器').setInputFiles({
    name: 'extreme.doupu.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByRole('textbox', { name: '设计名称' })).toHaveValue(value.name);
}

/** 测试专用 ZIP 中央目录解析；同时支持 client-zip 的 store/deflate 条目。 */
function extractZipEntries(bytes: Buffer): Map<string, Buffer> {
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === eocdSignature) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP 缺少中央目录结束记录');

  const entryCount = bytes.readUInt16LE(eocd + 10);
  let cursor = bytes.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP 本地条目损坏: ${name}`);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const content = method === 0
      ? Buffer.from(compressed)
      : method === 8
        ? inflateRawSync(compressed)
        : (() => { throw new Error(`ZIP 使用了不支持的压缩方法 ${method}`); })();
    expect(content.length, `${name} 解压后长度`).toBe(uncompressedSize);
    entries.set(name, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function decodePngSummary(page: Page, bytes: Buffer): Promise<{
  width: number;
  height: number;
  samples: number[][];
}> {
  return page.evaluate(async (base64) => {
    const binary = atob(base64);
    const data = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const points = [
      [0, 0],
      [canvas.width - 1, 0],
      [0, canvas.height - 1],
      [canvas.width - 1, canvas.height - 1],
      [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)],
    ];
    return {
      width: canvas.width,
      height: canvas.height,
      samples: points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]),
    };
  }, bytes.toString('base64'));
}

test('200×1 PNG has cross-browser decodable golden pixels and 500-color PDF paginates', async ({ page }) => {
  await page.goto('/app');
  await uploadFile(page, PHOTO);
  await expect(page.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });

  const pngProject = project(200, 1, [
    { code: 'RED-LONG-CODE-000001', hex: '#FF0000' },
    { code: 'BLUE-LONG-CODE-00002', hex: '#0000FF' },
  ]);
  await importProject(page, pngProject);
  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载 PNG', exact: true }).click(),
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

  await page.getByRole('button', { name: 'PNG 选项', exact: true }).click();
  await selectChoice(page,'格子大小','8px');
  await page.getByRole('switch', { name: '包含图例与色号清单' }).check();
  const [legendPngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('region', { name: 'PNG 导出选项' }).getByRole('button', { name: '导出', exact: true }).click(),
  ]);
  const legendPngBytes = readFileSync((await legendPngDownload.path())!);
  const opaqueLegend = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minAlpha = 255;
    for (let index = 3; index < pixels.length; index += 4) minAlpha = Math.min(minAlpha, pixels[index]);
    const footerCorner = [...context.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data];
    return { width: canvas.width, height: canvas.height, minAlpha, footerCorner };
  }, legendPngBytes.toString('base64'));
  expect(opaqueLegend.width).toBe(1600);
  expect(opaqueLegend.height).toBeGreaterThan(8);
  expect(opaqueLegend.minAlpha).toBe(255);
  expect(opaqueLegend.footerCorner).toEqual([255, 255, 255, 255]);

  const colors500 = Array.from({ length: 500 }, (_, index) => ({
    code: `C${String(index + 1).padStart(4, '0')}-LONG`,
    hex: `#${String(index + 1).padStart(6, '0')}`,
  }));
  await importProject(page, project(25, 20, colors500));
  await page.getByRole('button', { name: /导出 PDF/ }).click();
  await expect(page.getByText(/图纸 \d+ 页.*图例清单 \d+ 页/)).toBeVisible();
  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('region', { name: '确认导出 PDF' }).getByRole('button', { name: '导出', exact: true }).click(),
  ]);
  const pdf = await PDFDocument.load(readFileSync((await pdfDownload.path())!));
  expect(pdf.getPageCount()).toBeGreaterThan(2);
});

test('合并超限时 ZIP 恰好包含两张可解码且不透明的 PNG', async ({ page }) => {
  await page.goto('/app');
  await uploadFile(page, PHOTO);
  await expect(page.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });

  const colors = Array.from({ length: 500 }, (_, index) => ({
    code: `C${String(index + 1).padStart(4, '0')}-LONG`,
    hex: `#${String(index + 1).padStart(6, '0')}`,
  }));
  const value = project(170, 170, colors);
  value.name = 'ZIP极限';
  await importProject(page, value);
  await page.getByRole('button', { name: 'PNG 选项', exact: true }).click();
  await page.getByRole('switch', { name: '包含图例与色号清单' }).check();
  await expect(page.getByRole('status').filter({ hasText: '打包为两张 PNG' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('region', { name: 'PNG 导出选项' }).getByRole('button', { name: '导出', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('豆谱-ZIP极限-170x170-PNG.zip');
  const entries = extractZipEntries(readFileSync((await download.path())!));
  expect([...entries.keys()].sort()).toEqual([
    '豆谱-ZIP极限-170x170-图例.png',
    '豆谱-ZIP极限-170x170-图纸.png',
  ]);

  const patternPng = entries.get('豆谱-ZIP极限-170x170-图纸.png')!;
  const legendPng = entries.get('豆谱-ZIP极限-170x170-图例.png')!;
  expect(patternPng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(legendPng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const [patternSummary, legendSummary] = await Promise.all([
    decodePngSummary(page, patternPng),
    decodePngSummary(page, legendPng),
  ]);
  expect(patternSummary).toMatchObject({ width: 4080, height: 4080 });
  expect(legendSummary.width).toBeGreaterThanOrEqual(960);
  expect(legendSummary.height).toBeGreaterThan(32);
  for (const sample of [...patternSummary.samples, ...legendSummary.samples]) {
    expect(sample[3]).toBe(255);
  }
  expect(legendSummary.samples[3]).toEqual([255, 255, 255, 255]);
});
