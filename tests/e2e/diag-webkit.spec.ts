// 临时诊断：WebKit 对合成 PNG 的 createImageBitmap 行为（跑完即删）
import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PHOTO = readFileSync(resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png')).toString('base64');
const TRANSPARENT = readFileSync(resolve(process.cwd(), 'tests/fixtures/transparent-64.png')).toString('base64');

test('diag png decode', async ({ page }) => {
  await page.goto('about:blank');
  const result = await page.evaluate(async ({ photo }) => {
    const bytes = Uint8Array.from(atob(photo), (c) => c.charCodeAt(0));
    const parts: Record<string, unknown> = {};
    try {
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
        imageOrientation: 'from-image',
      });
      parts.bitmap = `${bmp.width}x${bmp.height}`;
      const canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(bmp.width, bmp.height)
          : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
      const ctx = canvas.getContext('2d');
      parts.ctx2d = ctx ? 'ok' : 'NULL';
      if (!ctx) throw new Error('no ctx');
      ctx.drawImage(bmp, 0, 0);
      parts.drawImage = 'ok';
      const imageData = ctx.getImageData(0, 0, bmp.width, bmp.height);
      parts.getImageData = `ok ${imageData.data.length}`;
      bmp.close();
    } catch (e) {
      parts.pipelineError = String(e);
    }
    return parts;
  }, { photo: PHOTO });
  // eslint-disable-next-line no-console
  console.log('DIAG RESULT:', JSON.stringify(result));
});
