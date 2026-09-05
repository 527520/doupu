import { webkit, expect } from '@playwright/test';
import { resolve } from 'node:path';

const baseURL = process.env.E2E_BASE_URL ?? 'https://127.0.0.1:3448';
if (!['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw new Error('Local candidate only');
const browser = await webkit.launch();
try {
  for (const width of [350, 390]) {
    const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, viewport: { width, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const apiWrites = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) apiWrites.push(path);
    });
    await page.goto('/app?new=1');
    await page.waitForFunction(() => document.documentElement.dataset.doupuHydrated === 'true');
    await page.getByLabel('图片文件选择器').setInputFiles(resolve('tests/fixtures/photo-wide-320x200.png'));
    await expect(page.getByText(/共 6300 粒/).first()).toBeVisible();
    await page.getByRole('button', { name: '裁剪图片', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: '裁剪图片' })).toBeVisible();
    await page.screenshot({ path: resolve(`.scratch/optional-recrop/crop-${width}.png`) });
    await page.getByRole('button', { name: '1:1', exact: true }).tap();
    await page.getByRole('button', { name: '确认并更新' }).tap();
    await expect(page.getByText(/共 10000 粒/).first()).toBeVisible();
    expect(apiWrites).toEqual([]);
    console.log(JSON.stringify({ width, automaticPreview: true, cropUpdated: true, apiWrites, screenshot: `crop-${width}.png` }));
    await context.close();
  }
} finally { await browser.close(); }
