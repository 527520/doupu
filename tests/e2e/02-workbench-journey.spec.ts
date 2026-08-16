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
  await uploadFile(page, PHOTO);

  // 裁剪步骤：默认全图，直接确认
  await page.getByRole('button', { name: '确认裁剪' }).click({ timeout: 15_000 });

  // 工作台：生成图纸（默认宽度 100 → 100×100）
  await expect(page.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });

  // 参数面板：宽度改为 20 → 防抖重生成 20×20=400 粒
  await fillField(page, '目标宽度（格）', '20');
  await page.getByRole('spinbutton', { name: '目标宽度（格）' }).blur();
  await expect(page.getByText(/共 400 粒/).first()).toBeVisible({ timeout: 20_000 });

  // 优化票 07：Worker 后台生成
  // a) 打开「抖动」（让 200×200 生成 ~0.7-2s，取消按钮有确定性的可见窗口），
  //    宽度 200 触发大图生成（200×200=40000 粒）：生成期间页面不冻结（输入框立即可交互），
  //    生成中显示可点击的「取消」按钮。取消用键盘激活（focus+Enter，规避进度重渲染时
  //    点击坐标命中检测在 Firefox 上的偶发拦截）
  const widthInput = page.getByRole('spinbutton', { name: '目标宽度（格）' });
  const cancelBtn = page.getByRole('button', { name: '取消', exact: true });
  await page.getByRole('checkbox', { name: '抖动' }).check();
  await typeSpin(page, '目标宽度（格）', '200');
  await widthInput.blur();
  await expect(widthInput).toBeEnabled({ timeout: 5_000 });
  await cancelBtn.waitFor({ timeout: 5_000 });
  await cancelBtn.focus();
  await page.keyboard.press('Enter');
  await expect(cancelBtn).toBeHidden({ timeout: 5_000 });

  // b) 乱序防护：取消后 Workbench 参数仍是宽度 200（其结果被丢弃但参数保留）。
  //    每一步都用可观测的统计数字确认面板已上抛（等值断言会被旧状态蒙混）
  const colorsInput = page.getByRole('spinbutton', { name: '目标颜色数' });
  await typeSpin(page, '目标颜色数', '2');
  await colorsInput.blur();
  await expect(page.getByText(/共 40000 粒 · 2 种颜色/).first()).toBeVisible({ timeout: 20_000 });
  await typeSpin(page, '目标宽度（格）', '20');
  await widthInput.blur();
  await expect(page.getByText(/共 400 粒 · 2 种颜色/).first()).toBeVisible({ timeout: 20_000 });
  await typeSpin(page, '目标宽度（格）', '200');
  await widthInput.blur();
  await cancelBtn.waitFor({ timeout: 5_000 }); // 大图任务已在 Worker 中运行
  await typeSpin(page, '目标宽度（格）', '20'); // 生成中改参数（乱序防护；真实键盘输入）
  await widthInput.blur();
  await expect(page.getByText(/共 400 粒 · 2 种颜色/).first()).toBeVisible({ timeout: 20_000 });
  await expect(cancelBtn).toBeHidden({ timeout: 5_000 }); // 在途生成全部结束：画布/统计为最终状态

  // 悬停显示格信息（工作台工具提示）：带重悬停重试（最终生成的画布重绘可能吞掉首次 mousemove）
  await expect(async () => {
    await page.locator('canvas').first().hover({ position: { x: 8, y: 8 } });
    await expect(page.getByRole('status').filter({ hasText: /第 0 行/ }).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });

  // 编辑：切换编辑页签，画笔点涂后撤销
  await page.getByRole('tab', { name: /编辑/ }).click();
  await page.locator('canvas').first().click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+z');

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
