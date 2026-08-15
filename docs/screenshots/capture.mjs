// README 截图生成器：需要本地 dev 服务器已在运行（默认 http://localhost:3000）。
// 用法：node docs/screenshots/capture.mjs
// 输出：docs/screenshots/home.png、docs/screenshots/workbench.png
import { chromium } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = dirname(fileURLToPath(import.meta.url));
const PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-wide-320x200.png');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });

  // 首页
  await page.goto(`${BASE}/`);
  await page.locator('h1').waitFor();
  await page.screenshot({ path: resolve(OUT, 'home.png'), fullPage: true });

  // 工作台：上传 → 确认裁剪（整图）→ 等待生成完成
  await page.goto(`${BASE}/app`);
  await page.getByLabel('图片文件选择器').waitFor({ timeout: 15_000 });
  await page.getByLabel('图片文件选择器').setInputFiles(PHOTO);
  await page.getByRole('heading', { name: '裁剪图片' }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '确认裁剪' }).click();
  await page.getByText(/共 \d+ 粒/).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: resolve(OUT, 'workbench.png') });
} finally {
  await browser.close();
}
console.log(`screenshots written to ${OUT}`);
