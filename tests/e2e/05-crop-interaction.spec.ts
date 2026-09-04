/**
 * E2E 裁剪交互回归（修复：画布被 flex/grid 拉伸导致坐标错乱的 bug）。
 * 使用 320×200 大图（角手柄热区占比小），真实鼠标拖拽验证：
 * 四角缩放 / 框内移动 / 框外拖拽框选 / 1:1 锁定。
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { uploadFile } from './helpers';

const PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-wide-320x200.png');

async function openCropper(page: import('@playwright/test').Page) {
  await page.goto('/app');
  await uploadFile(page, PHOTO);
  await page.getByRole('heading', { name: '裁剪图片' }).waitFor({ timeout: 15_000 });
}

/** 等待画布布局稳定（320×200 展示尺寸），再取包围盒——防止在默认 300×150 闪现帧上取坐标。 */
async function canvasBox(page: import('@playwright/test').Page) {
  const canvas = page.locator('canvas[aria-label*="裁剪"]');
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(310);
  return (await canvas.boundingBox())!;
}

function sizeLabel(page: import('@playwright/test').Page) {
  return page.locator('p', { hasText: /×/ }).first();
}

async function sizeOf(page: import('@playwright/test').Page): Promise<{ w: number; h: number }> {
  await expect(sizeLabel(page)).toHaveText(/当前选区：\d+ × \d+ 像素/);
  const text = (await sizeLabel(page).textContent())!;
  const m = text.match(/(\d+) × (\d+)/)!;
  return { w: Number(m[1]), h: Number(m[2]) };
}

test('四角手柄缩放：右下角拖到 50% → 约 160×100', async ({ page }) => {
  await openCropper(page);
  const box = await canvasBox(page);

  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 10 });
  await page.mouse.up();

  const { w, h } = await sizeOf(page);
  expect(w).toBeGreaterThan(150);
  expect(w).toBeLessThan(170);
  expect(h).toBeGreaterThan(90);
  expect(h).toBeLessThan(110);
});

test('框内拖动整体移动：选区尺寸不变', async ({ page }) => {
  await openCropper(page);
  const box = await canvasBox(page);

  // 先缩小（右下角 → 75%），得到可移动的选区 (0,0,240,150)
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 6 });
  await page.mouse.up();
  const before = await sizeOf(page);

  // 框内（远离角手柄热区）拖动
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3 + 30, box.y + box.height * 0.3 + 20, { steps: 6 });
  await page.mouse.up();

  const after = await sizeOf(page);
  expect(after.w).toBe(before.w);
  expect(after.h).toBe(before.h);
});

test('框外拖拽框选：新选区与拖动范围一致', async ({ page }) => {
  await openCropper(page);
  const box = await canvasBox(page);

  // 先缩小选区到左上 1/4（右下角 → 25%），留出大片框外区域
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25, { steps: 8 });
  await page.mouse.up();

  // 框外（60%,60%）拖到（90%,85%）→ 约 96×50
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.85, { steps: 8 });
  await page.mouse.up();

  const { w, h } = await sizeOf(page);
  expect(w).toBeGreaterThan(80);
  expect(w).toBeLessThan(110);
  expect(h).toBeGreaterThan(40);
  expect(h).toBeLessThan(60);
});

test('1:1 比例锁定：拖拽框选强制正方形', async ({ page }) => {
  await openCropper(page);
  await page.getByRole('button', { name: '1:1' }).click();
  const box = await canvasBox(page);

  // 先缩小选区（右下角 → 25%）
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25, { steps: 8 });
  await page.mouse.up();

  // 框外拖拽框选（非正方形范围）
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();

  const { w, h } = await sizeOf(page);
  expect(w).toBe(h);
});

test('边框手柄缩放：拖顶边中点只改高度、宽度不变', async ({ page }) => {
  await openCropper(page);
  const box = await canvasBox(page);

  // 先缩小到左上 1/2（右下角 → 50%），得到选区 (0,0,160,100)
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();

  // 顶边中点（选区上沿 x=80px 处）向下拖约 15% 画布高 → 高度 100→70、宽度保持 160。
  // 从画布内侧 2px 开始，避免 Firefox 将恰好落在元素上边界的坐标命中到父容器。
  await page.mouse.move(box.x + box.width * 0.25, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.15, { steps: 6 });
  await page.mouse.up();

  const { w, h } = await sizeOf(page);
  expect(w).toBe(160);
  expect(h).toBeGreaterThan(64);
  expect(h).toBeLessThan(76);
});

test('点击画布后方向键移动选区，Shift 将步长提升到 10 像素', async ({ page }) => {
  await openCropper(page);
  const canvas = page.locator('canvas[aria-label*="裁剪"]');
  const box = await canvasBox(page);

  // 先缩小全图选区，给键盘移动留出空间。
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();

  await canvas.click({ position: { x: box.width * 0.25, y: box.height * 0.25 } });
  await expect(canvas).toBeFocused();
  const status = page.getByRole('status').filter({ hasText: '选区起点' });
  await expect(status).toContainText('选区起点：X 0 · Y 0');

  await page.keyboard.press('ArrowRight');
  await expect(status).toContainText('选区起点：X 1 · Y 0');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(status).toContainText('选区起点：X 1 · Y 10');
});

test('窄屏（350px）：画布保持原图 1.6 宽高比不拉伸，且 touch-action 为 none', async ({ page }) => {
  await page.setViewportSize({ width: 350, height: 700 });
  await openCropper(page);
  const canvas = page.locator('canvas[aria-label*="裁剪"]');
  // 等待画布到达稳定状态：收缩到容器宽度（< 原图 320px）且未塌缩（> 240px），
  // 避免在首帧默认尺寸/被夹宽的中间帧上取包围盒。
  // 重构后 studio 面板窄屏内边距（页面 14×2 + 面板 18×2 + 画布槽 8×2 ≈ 80px），
  // 350px 视口下画布约 268px。
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0, { timeout: 10_000 }).toBeLessThan(320);
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0, { timeout: 10_000 }).toBeGreaterThan(240);
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBeGreaterThan(240);
  const ratio = box.width / box.height;
  expect(ratio).toBeGreaterThan(1.55);
  expect(ratio).toBeLessThan(1.65);
  const touchAction = await canvas.evaluate((el) => getComputedStyle(el).touchAction);
  expect(touchAction).toBe('none');
});
