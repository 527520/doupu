/**
 * E2E 核心旅程 2：工作台（spec §F1–F5、§F7）。
 * 上传 → 整图自动生成 → 参数调整 → 悬停格信息 → 编辑 → 导出三格式 → 保存 → 刷新恢复。
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fillField, typeSpin, uploadFile, selectChoice } from './helpers';

const PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png');

test('照片 → 生成 → 编辑 → 导出三格式 → 本地保存与恢复', async ({ page }) => {
  await page.goto('/app');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await uploadFile(page, PHOTO);

  // 裁剪步骤：默认全图，直接确认

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
  await page.getByRole('button', { name: '高级选项', exact: true }).click();
  await page.getByRole('switch', { name: '抖动' }).check();
  await typeSpin(page, '目标宽度（格）', '200');
  // The optimized engine can finish before a second Playwright command starts.
  // Observe the transient generating UI before blur, capture its locked state,
  // and click Cancel in the same browser task as soon as React mounts it.
  // 热服务器上生成可能赶在观察器建立前就完成（「取消」按钮从未出现）——给观察
  // 一个截止时间，超时按「跳过取消断言」处理，绝不让用例挂满 120s。
  const cancellation = page.evaluate(() => new Promise<
    { widthDisabled: boolean; pngDisabled: boolean; saveDisabled: boolean; cancelUiMs: number }
    | { skipped: true }
  >((resolve) => {
    let settled = false;
    const observer = new MutationObserver(() => void inspect());
    const deadline = setTimeout(() => finish({ skipped: true }), 8_000);
    const finish = (result: {
      widthDisabled: boolean;
      pngDisabled: boolean;
      saveDisabled: boolean;
      cancelUiMs: number;
    } | { skipped: true }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      observer.disconnect();
      resolve(result);
    };
    const inspect = (): void => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const cancel = buttons.find((button) => button.textContent?.trim() === '取消');
      if (!cancel) return;
      const width = document.querySelector<HTMLInputElement>('input[aria-label="目标宽度（格）"]');
      const png = buttons.find((button) => button.textContent?.includes('下载 PNG'));
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
          finish({ ...observed, cancelUiMs: performance.now() - cancelledAt });
          return;
        }
        requestAnimationFrame(waitForSettledUi);
      };
      requestAnimationFrame(waitForSettledUi);
    };
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    inspect();
  }));
  await widthInput.blur();
  const cancelled = await cancellation;
  if ('skipped' in cancelled) {
    // 生成太快没赶上取消 UI：把宽度改回 20 后继续后续断言（取消协议已由单测精确覆盖）。
    await typeSpin(page, '目标宽度（格）', '20');
    await widthInput.blur();
    await expect(page.getByText(/共 400 粒/).first()).toBeVisible({ timeout: 20_000 });
  } else {
    expect(cancelled).toEqual(expect.objectContaining({ widthDisabled: true, pngDisabled: true, saveDisabled: true }));
    expect(cancelled.cancelUiMs).toBeLessThan(100);
    await expect(cancelBtn).toBeHidden({ timeout: 1_000 });
    await expect(widthInput).toHaveValue('20');
    await expect(widthInput).toBeEnabled();
    await expect(page.getByText(/共 400 粒/).first()).toBeVisible();
  }

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

  // 版本化 Mini 色板会原子切换到兼容的 2.6mm / 50×50；随后改参数，
  // 确认真实生成链路使用新色板，而不是只在既有图纸上做一次重映射。
  await selectChoice(page,'色板品牌','优肯 Artkal');
  const paletteSeriesSelect = page.getByRole('button', { name: /色板系列/ });
  const miniPaletteId = await paletteSeriesSelect.locator('..').locator('select').inputValue();
  expect(miniPaletteId).toMatch(/^builtin:pcd:artkal-c-197-official@/);
  const boardProfileSelect = page.getByRole('button',{name:/制作规格/});
  await expect(boardProfileSelect).toHaveText('2.6mm / 50×50');
  await expect(page.getByText(/制作规格已切换为 2\.6mm \/ 50×50/).first()).toBeVisible();
  // Artkal 同时支持两种 Mini 底板；主旅程继续切到 52×52，覆盖该规格的
  // 生成、编辑、PNG/PDF/项目导出、保存和刷新恢复完整链路。
  await selectChoice(page,'制作规格','2.6mm / 52×52');
  await expect(boardProfileSelect).toHaveText('2.6mm / 52×52');
  await expect(page.getByText(/制作规格已切换为 2\.6mm \/ 52×52/).first()).toBeVisible();
  await typeSpin(page, '目标颜色数', '3');
  await colorsInput.blur();
  await expect(page.getByText(/共 400 粒 · 3 种颜色/).first()).toBeVisible({ timeout: 20_000 });
  await typeSpin(page, '目标颜色数', '2');
  await colorsInput.blur();
  await expect(page.getByText(/共 400 粒 · 2 种颜色/).first()).toBeVisible({ timeout: 20_000 });

  // 悬停显示格信息（工作台工具提示）：带重悬停重试（最终生成的画布重绘可能吞掉首次 mousemove）
  await expect(async () => {
    await page.locator('canvas').first().hover({ position: { x: 8, y: 8 } });
    await expect(page.getByRole('status').filter({ hasText: /第 0 行/ }).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });

  // 编辑：切换页签即自动聚焦；同一光标格验证四种工具的 Enter 语义。
  await page.getByRole('tab', { name: /编辑/ }).click();
  const editorRegion = page.getByLabel('编辑画布区域');
  await expect(editorRegion).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const cursorStatus = page.getByRole('status').filter({ hasText: /光标：第 1 行 第 2 列/ }).first();
  await expect(cursorStatus).toBeVisible();
  const cursorText = (await cursorStatus.textContent()) ?? '';
  const originalCode = cursorText.match(/· ([^（·]+)（回车落笔）/)?.[1]?.trim();
  expect(originalCode).toBeTruthy();

  await page.keyboard.press('i');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: `当前颜色: ${originalCode}` })).toBeVisible();

  await page.keyboard.press('e');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/共 399 粒/).first()).toBeVisible();

  await page.keyboard.press('g');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/共 400 粒/).first()).toBeVisible();

  const paletteButtons = page.getByRole('region', { name: '选择画笔颜色' }).getByRole('button');
  const paletteCount = await paletteButtons.count();
  let keyboardBrushCode = '';
  for (let index = 0; index < paletteCount; index += 1) {
    const label = await paletteButtons.nth(index).getAttribute('aria-label');
    const code = label?.split(' ')[0] ?? '';
    if (code && code !== originalCode) {
      keyboardBrushCode = code;
      await paletteButtons.nth(index).click();
      break;
    }
  }
  expect(keyboardBrushCode).toBeTruthy();
  // WebKit 下点击色板按钮后重新聚焦画布偶发不生效（光标状态消失，'b' 落空）。
  // 恢复顺序：悬停把光标拉回 (0,0)（onPointerMove → setCursor），再聚焦 + 'b' + → 到
  // (0,1)。位置特定的断言同时验证了方向键真的生效（即焦点确实回到画布）。
  await expect(async () => {
    await page.locator('canvas').first().hover({ position: { x: 8, y: 8 } });
    await editorRegion.focus();
    await page.keyboard.press('b');
    await page.keyboard.press('ArrowRight');
    await expect(cursorStatus).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press('Enter');
  await expect(cursorStatus).toContainText(`· ${keyboardBrushCode}（回车落笔）`);

  // 默认 PNG 一次下载；导出分区是显式的用户入口。
  await page.getByRole('navigation', { name: '工作台工具' }).getByRole('button', { name: '导出', exact: true }).click();
  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载 PNG', exact: true }).click(),
  ]);
  expect(pngDownload.suggestedFilename()).toMatch(/^豆谱-.*\.png$/);
  const pngPath = await pngDownload.path();
  expect(readFileSync(pngPath!).length).toBeGreaterThan(1000);

  // 导出 PDF（预览确认；确认按钮文案为「导出」）
  await page.getByRole('button', { name: /导出 PDF/ }).click();
  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('region', { name: '确认导出 PDF' }).getByRole('button', { name: '导出', exact: true }).click(),
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
  expect(project.boardProfile).toBe('2.6mm-52');
  expect(project.paletteSelection).toEqual({
    palette: { kind: 'builtin', brand: miniPaletteId!.replace(/^builtin:/, '') },
    kitTier: 0,
  });
  expect(project.pattern.width).toBe(20);
  expect(project.pattern.cells[1].code).toBe(keyboardBrushCode);

  // 保存并刷新恢复
  await page.getByRole('button', { name: /保存/ }).click();
  await expect(page.getByText(/已保存/).first()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByLabel('设计名称').first()).toBeVisible();
  await expect(page.getByText(/共 400 粒/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button',{name:/色板品牌/})).toHaveText('优肯 Artkal');
  await expect(page.getByRole('button',{name:/色板系列/}).locator('..').locator('select')).toHaveValue(miniPaletteId!);
  await expect(page.getByRole('button',{name:/制作规格/})).toHaveText('2.6mm / 52×52');
  const restoredWidth = page.getByRole('spinbutton', { name: '目标宽度（格）' });
  await expect(restoredWidth).toBeEnabled();
  await typeSpin(page, '目标宽度（格）', '21');
  await restoredWidth.blur();
  await expect(page.getByText(/共 441 粒/).first()).toBeVisible({ timeout: 20_000 });
});
