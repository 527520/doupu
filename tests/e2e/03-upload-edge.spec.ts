/**
 * E2E 边界用例：上传校验（spec §6 E1–E13 的可浏览器断言部分）。
 * 动画 GIF 拒绝、改名文本拒绝、截断 PNG 解码失败、透明 PNG 全透明提示。
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = (name: string) => resolve(process.cwd(), 'tests/fixtures', name);

async function uploadAndExpectError(page: import('@playwright/test').Page, fixtureName: string, errorText: RegExp): Promise<void> {
  await page.goto('/app');
  await page.getByLabel('图片文件选择器').setInputFiles(fixture(fixtureName));
  await expect(page.getByText(errorText).first()).toBeVisible({ timeout: 10_000 });
}

test('E4：动画 GIF 拒绝', async ({ page }) => {
  await uploadAndExpectError(page, 'animated-2frames.gif', /不支持动图/);
});

test('E3：改名文本文件按内容嗅探拒绝', async ({ page }) => {
  await uploadAndExpectError(page, 'text-as-photo.jpg', /不支持的图片格式/);
});

test('E2：截断 PNG 解码失败提示', async ({ page }) => {
  await uploadAndExpectError(page, 'truncated.png', /无法解析该图片/);
});

test('E10：全透明 PNG 生成后提示图纸为空（导出侧拦截）', async ({ page }) => {
  // 全透明 fixture：生成后统计为 0，PNG 导出按钮给出空图错误
  await page.goto('/app');
  await page.getByLabel('图片文件选择器').setInputFiles(fixture('transparent-64.png'));
  await page.getByRole('button', { name: /跳过裁剪|确认/ }).first().click();
  await expect(page.getByText(/共 0 粒/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /导出 PNG/ }).click();
  await expect(page.getByText(/图纸为空/).first()).toBeVisible();
});
