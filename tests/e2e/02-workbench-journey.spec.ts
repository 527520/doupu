/**
 * E2E 核心旅程 2：工作台（spec §F1–F5、§F7）。
 * 上传 → 确认裁剪（整图）→ 参数调整 → 生成 → 悬停格信息 → 编辑 → 导出三格式 → 保存 → 刷新恢复。
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fillField, typeSpin, uploadFile } from './helpers';

const PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png');

test('照片 → 生成 → 编辑 → 导出三格式 → 本地保存与恢复', async ({ page }) => {
  await page.goto('/app');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await uploadFile(page, PHOTO);

  // 裁剪步骤：默认全图，直接确认
  await page.getByRole('button', { name: '确认裁剪' }).click({ timeout: 15_000 });

  // 工作台：生成图纸（默认宽度 100 → 100×100）
  await expect(page.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });

  // 参数面板：宽度改为 20 → 防抖重生成 20×20=400 粒
  await fillField(page, '目标宽度（格）', '20');
  await page.getByRole('spinbutton', { name: '目标宽度（格）' }).blur();
  await expect(page.getByText(/共 400 粒/).first()).toBeVisible({ timeout: 20_000 });

  // 持久 Worker + SharedArrayBuffer 协作式取消：生成期间编辑/保存/导出锁定，
  // 取消后恢复到上一个已提交快照。
  const widthInput = page.getByRole('spinbutton', { name: '目标宽度（格）' });
  const cancelBtn = page.getByRole('button', { name: '取消', exact: true });
  await page.getByRole('checkbox', { name: '抖动' }).check();
  await typeSpin(page, '目标宽度（格）', '200');
  // The optimized engine can finish before a second Playwright command starts.
  // Observe the transient generating UI before blur, capture its locked state,
  // and click Cancel in the same browser task as soon as React mounts it.
  const cancellation = page.evaluate(() => new Promise<{
    widthDisabled: boolean;
    pngDisabled: boolean;
    saveDisabled: boolean;
    cancelUiMs: number;
  }>((resolve) => {
    const inspect = (): boolean => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const cancel = buttons.find((button) => button.textContent?.trim() === '取消');
      if (!cancel) return false;
      const width = document.querySelector<HTMLInputElement>('input[aria-label="目标宽度（格）"]');
      const png = buttons.find((button) => button.textContent?.includes('导出 PNG'));
      const save = buttons.find((button) => button.textContent?.includes('保存'));
      const observed = {
        // The input is effectively disabled by its ancestor fieldset.
        widthDisabled: Boolean(width?.matches(':disabled')),
        pngDisabled: Boolean(png?.disabled),
        saveDisabled: Boolean(save?.disabled),
      };
      const cancelledAt = performance.now();
      cancel.click();
      const waitForSettledUi = (): void => {
        if (!document.body.contains(cancel)) {
          observer.disconnect();
          resolve({ ...observed, cancelUiMs: performance.now() - cancelledAt });
          return;
        }
        requestAnimationFrame(waitForSettledUi);
      };
      requestAnimationFrame(waitForSettledUi);
      return true;
    };
    const observer = new MutationObserver(() => void inspect());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    inspect();
  }));
  await widthInput.blur();
  const cancelled = await cancellation;
  expect(cancelled).toEqual(expect.objectContaining({ widthDisabled: true, pngDisabled: true, saveDisabled: true }));
  expect(cancelled.cancelUiMs).toBeLessThan(100);
  await expect(cancelBtn).toBeHidden({ timeout: 1_000 });
  await expect(widthInput).toHaveValue('20');
  await expect(widthInput).toBeEnabled();
  await expect(page.getByText(/共 400 粒/).first()).toBeVisible();

  // latest-only 任务协议的乱序在单测精确覆盖；浏览器这里验证取消后可再生成。
  const colorsInput = page.getByRole('spinbutton', { name: '目标颜色数' });
  const restartStarted = Date.now();
  await typeSpin(page, '目标颜色数', '2');
  await colorsInput.blur();
  await expect(page.getByText(/共 400 粒 · 2 种颜色/).first()).toBeVisible({ timeout: 20_000 });
  expect(Date.now() - restartStarted).toBeLessThan(2_000);
  await typeSpin(page, '目标宽度（格）', '200');
  await widthInput.blur();
  await expect(page.getByText(/共 40000 粒 · 2 种颜色/).first()).toBeVisible({ timeout: 20_000 });
  await typeSpin(page, '目标宽度（格）', '20');
  await widthInput.blur();
  await expect(page.getByText(/共 400 粒 · 2 种颜色/).first()).toBeVisible({ timeout: 20_000 });

  // 悬停显示格信息（工作台工具提示）：带重悬停重试（最终生成的画布重绘可能吞掉首次 mousemove）
  await expect(async () => {
    await page.locator('canvas').first().hover({ position: { x: 8, y: 8 } });
    await expect(page.getByRole('status').filter({ hasText: /第 0 行/ }).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });

  // 编辑：切换编辑页签，画笔点涂后撤销
  await page.getByRole('tab', { name: /编辑/ }).click();
  await page.locator('canvas').first().click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('ControlOrMeta+z');

  // 导出 PNG（选项面板确认后断言下载）
  await page.getByRole('button', { name: /导出 PNG/ }).click();
  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出', exact: true }).click(),
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
