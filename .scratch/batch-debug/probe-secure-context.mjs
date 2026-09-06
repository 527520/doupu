// 只读诊断探针：验证 crypto.randomUUID 在两种访问来源下的可用性差异。
// 用后即弃，不属于产品代码。
import { chromium } from '@playwright/test';

const targets = ['http://127.0.0.1:3000/login', 'http://localhost:3000/login', 'http://192.168.1.175:3000/login'];

for (const url of targets) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  let reachable = true;
  try {
    await page.goto(url, { timeout: 15000 });
  } catch (error) {
    reachable = false;
    errors.push(`GOTO FAIL: ${error.message}`);
  }
  const info = reachable
    ? await page.evaluate(() => ({ isSecureContext: window.isSecureContext, randomUUIDType: typeof crypto.randomUUID }))
    : null;
  console.log(url, JSON.stringify(info), `pageErrors=${errors.length}`);
  if (errors.length) console.log('  ', errors.join(' | ').slice(0, 300));
  await browser.close();
}
