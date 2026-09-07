import { chromium } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const rawDir = '/Users/wuqian/Movies/.doupu-raw-video';
const output = '/Users/wuqian/Movies/doupu-douyin-promo-silent.webm';

await mkdir(rawDir, { recursive: true });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: rawDir,
      size: { width: 1080, height: 1920 },
    },
  });

  const page = await context.newPage();
  const video = page.video();
  await page.goto(pathToFileURL(resolve(here, 'promo.html')).href);
  await page.waitForFunction(() =>
    Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
  );
  await page.evaluate(() => document.body.classList.add('play'));
  await page.waitForTimeout(15_400);
  await page.close();
  await video.saveAs(output);
  await context.close();
} finally {
  await browser.close();
}

console.log(output);
