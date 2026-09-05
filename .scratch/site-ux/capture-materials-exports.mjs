import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3109' });
  await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('permission denied'); } }, configurable: true }));
  const page = await context.newPage();
  await page.goto('/app?new=1');
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await page.getByLabel('图片文件选择器').setInputFiles(resolve('tests/fixtures/photo-wide-320x200.png'));
  await expect(page.getByText(/共 6300 粒/).first()).toBeVisible({ timeout: 60000 });
  const inspect = async (name, width) => {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
    await page.screenshot({ path: resolve(`.scratch/site-ux/${name}-${width}.png`), fullPage: true });
    console.log(JSON.stringify({ name, width, noOverflow: true, seriousAxe: 0 }));
  };
  const download = async (action) => {
    const pending = page.waitForEvent('download'); await action();
    const result = await pending;
    expect(await result.failure()).toBeNull();
    const chunks = []; for await (const chunk of await result.createReadStream()) chunks.push(chunk);
    return { name: result.suggestedFilename(), bytes: Buffer.concat(chunks) };
  };
  for (const width of [350, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: '用色', exact: true }).click();
    await inspect('materials', width);
  }
  await page.getByRole('button', { name: '复制清单', exact: true }).click();
  await expect(page.getByLabel('手动复制材料清单')).toHaveValue(/6300 粒/);
  for (const width of [350, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: '导出', exact: true }).click();
    if (width < 768) await expect.poll(async () => {
      const box = await page.getByRole('button', { name: '下载 PNG', exact: true }).boundingBox();
      return box !== null && box.y >= 0 && box.y + box.height < 820;
    }).toBe(true);
    await inspect('exports', width);
  }
  const png = await download(() => page.getByRole('button', { name: '下载 PNG', exact: true }).click());
  expect(png.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  const pdfPanel = page.getByRole('region', { name: '确认导出 PDF' });
  await expect(pdfPanel).toContainText('实际大小 / 100%');
  const pdf = await download(() => pdfPanel.getByRole('button', { name: '导出', exact: true }).click());
  expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const projectFile = await download(() => page.getByRole('button', { name: '导出项目文件', exact: true }).click());
  const original = JSON.parse(projectFile.bytes.toString());
  expect(original.version).toBe(3);
  expect(projectFile.bytes.toString()).not.toMatch(/generationSource|originalSource|rgba|shareToken/);
  await page.getByRole('button', { name: '参数', exact: true }).click();
  const paletteLink = page.getByRole('link', { name: '查看完整色板库' });
  const designId = new URL(await paletteLink.getAttribute('href'), 'http://local').searchParams.get('designId');
  await paletteLink.click();
  await expect(page).toHaveURL(/\/palettes\?designId=/);
  await page.getByRole('searchbox').fill('C 系列 197');
  for (const width of [350, 390, 768, 1280, 1440]) await inspect('palette-library', width);
  await page.getByRole('link', { name: '用于当前图纸', exact: true }).click();
  await expect(page).toHaveURL(/\/app\?id=.+&palette=/);
  expect(new URL(page.url()).searchParams.get('id')).toBe(designId);
  await expect(page.getByLabel('制作规格', { exact: true })).toHaveValue('5mm-29');
  await page.getByRole('button', { name: '应用到这张图纸' }).click();
  await expect(page.getByLabel('制作规格', { exact: true })).toHaveValue('2.6mm-50');
  await page.getByRole('button', { name: '撤销上一步自动改动，恢复上一版图纸', exact: true }).click();
  await expect(page.getByLabel('制作规格', { exact: true })).toHaveValue('5mm-29');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const restored = JSON.parse((await download(() => page.getByRole('button', { name: '导出项目文件', exact: true }).click())).bytes.toString());
  expect(restored.pattern).toEqual(original.pattern);
  expect(restored.paletteSelection).toEqual(original.paletteSelection);
  console.log(JSON.stringify({ pngClicks: 1, pdfClicks: 2, projectClicks: 1, clipboardFallback: true, paletteTargetPreserved: true, undoRestoresPatternAndPalette: true }));
  await context.close();
} finally { await browser.close(); }
