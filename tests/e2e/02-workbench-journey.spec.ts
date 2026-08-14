/**
 * E2E 核心旅程 2：工作台（spec §F1–F5、§F7）。
 * 上传 → 确认裁剪（整图）→ 参数调整 → 生成 → 悬停格信息 → 编辑 → 导出三格式 → 保存 → 刷新恢复。
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fillField, uploadFile } from './helpers';

const PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png');

test('照片 → 生成 → 编辑 → 导出三格式 → 本地保存与恢复', async ({ page }) => {
  await page.goto('/app');
  await uploadFile(page, PHOTO);

  // 裁剪步骤：默认全图，直接确认
  await page.getByRole('button', { name: '确认裁剪' }).click({ timeout: 15_000 });

  // 工作台：生成图纸（默认宽度 100 → 100×100）
  await expect(page.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });

  // 参数面板：宽度改为 20 → 防抖重生成 20×20=400 粒
  await fillField(page, '目标宽度（格）', '20');
  await page.getByRole('spinbutton', { name: '目标宽度（格）' }).blur();
  await expect(page.getByText(/共 400 粒/).first()).toBeVisible({ timeout: 20_000 });

  // 悬停显示格信息（工作台工具提示）
  await page.locator('canvas').first().hover({ position: { x: 8, y: 8 } });
  await expect(page.getByRole('status').filter({ hasText: /第 0 行/ }).first()).toBeVisible();

  // 编辑：切换编辑页签，画笔点涂后撤销
  await page.getByRole('tab', { name: /编辑/ }).click();
  await page.locator('canvas').first().click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+z');

  // 导出 PNG（断言下载）
  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /导出 PNG/ }).click(),
  ]);
  expect(pngDownload.suggestedFilename()).toMatch(/^豆谱-.*\.png$/);
  const pngPath = await pngDownload.path();
  expect(readFileSync(pngPath!).length).toBeGreaterThan(1000);

  // 导出 PDF（预览确认；确认按钮文案为「导出」）
  await page.getByRole('button', { name: /导出 PDF/ }).click();
  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出', exact: true }).click(),
  ]);
  expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfPath = await pdfDownload.path();
  expect(readFileSync(pdfPath!).subarray(0, 4).toString('latin1')).toBe('%PDF');

  // 导出项目文件
  const [projectDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /导出项目文件/ }).click(),
  ]);
  expect(projectDownload.suggestedFilename()).toMatch(/\.json$/);
  const projectPath = await projectDownload.path();
  const project = JSON.parse(readFileSync(projectPath!, 'utf8'));
  expect(project.format).toBe('doupu-project');
  expect(project.pattern.width).toBe(20);

  // 保存并刷新恢复
  await page.getByRole('button', { name: /保存/ }).click();
  await expect(page.getByText(/已保存/).first()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByLabel('设计名称').first()).toBeVisible();
  await expect(page.getByText(/共 400 粒/).first()).toBeVisible({ timeout: 20_000 });
});
