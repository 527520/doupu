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

test('E2：截断 PNG —— 报解码错误或浏览器容忍进入裁剪，两者皆合法', async ({ page }) => {
  await openApp(page);
  await uploadFile(page, fixture('truncated.png'));
  const decodeError = page.getByText(/无法解析该图片/).first();
  const cropScreen = page.getByRole('heading', { name: '裁剪图片' });
  await expect(decodeError.or(cropScreen).first()).toBeVisible({ timeout: 10_000 });
});

test('E10：全透明 PNG 生成后统计为 0 且 PNG 导出禁用', async ({ page }) => {
  await openApp(page);
  await uploadFile(page, fixture('transparent-64.png'));
  await page.getByRole('button', { name: '确认裁剪' }).click({ timeout: 15_000 });
  await expect(page.getByText(/共 0 粒/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /导出 PNG/ })).toBeDisabled();
});

test('HEIC：非原生解码浏览器走 WASM 转换（成功进裁剪或友好报错皆合法，优化票 05）', async ({ page }) => {
  await openApp(page);
  await uploadFile(page, fixture('fake.heic'));
  // 伪 HEIC（ftyp 盒 + 垃圾字节）：转换成功则进入裁剪；libheif 拒绝则显示友好错误——两者皆合法
  const cropScreen = page.getByRole('heading', { name: '裁剪图片' });
  const heicError = page.getByText(/无法处理 HEIC/).first();
  await expect(cropScreen.or(heicError).first()).toBeVisible({ timeout: 30_000 });
});
