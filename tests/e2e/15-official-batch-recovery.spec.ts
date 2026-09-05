import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fillField } from './helpers';

const photo = readFileSync(resolve('tests/fixtures/photo-gradient-64.png'));
const image = (name: string) => ({ name, mimeType: 'image/png', buffer: photo });
async function login(page: Page) {
  await page.goto('/login?next=/admin/batches');
  await fillField(page, '邮箱', 'e2e-admin@example.com'); await fillField(page, '密码', 'E2e-pass-123!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/batches$/); await expect(page.locator('h1')).toBeVisible();
}
async function smallDefault(page: Page) {
  await page.getByText(/统一生成参数 ·/).click();
  await page.locator('.batch-studio > details').getByLabel('目标宽度').fill('20');
}

test('可视裁剪、创建与保存丢响应同键恢复、核对后发布和主动历史恢复', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  const privateName = `private-source-${info.project.name}.png`;
  await page.getByLabel('选择图片', { exact: true }).setInputFiles(image(privateName)); await smallDefault(page);
  await page.getByRole('button', { name: '预览并裁剪' }).click();
  const crop = page.getByRole('dialog', { name: '裁剪图片', exact: true }); await expect(crop).toBeVisible();
  await crop.getByLabel('裁剪选区画布').focus(); await page.keyboard.press('Alt+ArrowLeft');
  await crop.getByRole('button', { name: '确认并更新' }).click(); await expect(crop).toHaveCount(0);
  await expect(page.getByText(/裁剪区域 \d+×\d+ px/)).toBeVisible();
  const requests = new Map<string, Array<{ body: string | null; key: string | undefined }>>();
  let batchId = '';
  await page.route('**/api/admin/batches**', async (route) => {
    const req = route.request(); if (req.method() !== 'POST') return route.continue();
    const kind = req.url().endsWith('/drafts') ? 'draft' : req.url().endsWith('/publish') ? 'publish' : 'create';
    const writes = requests.get(kind) ?? []; writes.push({ body: req.postData(), key: req.headers()['idempotency-key'] }); requests.set(kind, writes);
    expect(req.postData()).not.toContain(privateName);
    const response = await route.fetch(); expect(response.status()).toBeLessThan(300);
    if (kind === 'create') batchId = (await response.json()).id;
    if (writes.length === 1) return route.fulfill({ status: 503, json: { error: { message: '本地模拟已提交后丢响应' } } });
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '开始生成' }).click();
  await expect(page.getByLabel('选择图片', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试确认上次操作' }).click();
  const item = page.locator('.batch-items > li').first();
  await expect(item).toContainText('保存结果待确认');
  await item.getByRole('button', { name: '重试确认保存' }).click();
  await expect(page.locator('.batch-studio [role=status]')).toContainText('生成完成');
  await expect(item.getByRole('checkbox', { name: '发布', exact: true })).not.toBeChecked();
  await item.getByRole('button', { name: '查看完整图纸' }).click();
  const material = page.getByRole('dialog', { name: '查看完整图纸' });
  await expect(material.locator('canvas').first()).toBeVisible();
  await material.getByRole('button', { name: '关闭', exact: true }).click();
  await item.getByRole('checkbox', { name: '发布', exact: true }).check();
  await page.getByRole('button', { name: /发布已勾选草稿/ }).click();
  const publication = page.getByRole('dialog', { name: '发布已勾选草稿', exact: true });
  await expect(publication.getByRole('button', { name: '确认公开所选草稿' })).toBeDisabled();
  await publication.getByRole('checkbox').check(); await publication.getByRole('button', { name: '确认公开所选草稿' }).click();
  await expect(publication.getByRole('button', { name: '返回草稿' })).toBeDisabled();
  await publication.getByRole('button', { name: '重试确认上次操作' }).click(); await expect(publication).toHaveCount(0);
  await expect(item.getByRole('link', { name: '查看公开作品' })).toBeVisible();
  for (const kind of ['create', 'draft', 'publish']) { expect(requests.get(kind)).toHaveLength(2); expect(requests.get(kind)![0]).toEqual(requests.get(kind)![1]); }
  const stored = await page.evaluate(async (id) => (await (await fetch('/api/admin/batches')).json()).items.find((entry: { id: string }) => entry.id === id), batchId);
  expect(stored.successCount).toBe(1); expect(stored.drafts).toHaveLength(1); expect(stored.drafts[0].status).toBe('published');
  await page.reload(); await expect(page.locator('.batch-items > li')).toHaveCount(0);
  await page.getByText('恢复已保存批次（最近 50 批）').click();
  await page.locator('.batch-history li').filter({ hasText: batchId }).getByRole('button').click();
  await expect(page.locator('.batch-items > li')).toHaveCount(1); await expect(page.locator('.batch-items input[type=checkbox]')).toHaveCount(0);
});

test('暂停只停止新派发，取消待处理项后继续不丢失正在保存的结果', async ({ page }) => {
  await login(page); await page.getByLabel('选择图片', { exact: true }).setInputFiles([1, 2, 3, 4].map((n) => image(`pause-${n}.png`))); await smallDefault(page);
  let held = 0; let release!: () => void; const gate = new Promise<void>((done) => { release = done; });
  await page.route('**/api/admin/batches/*/drafts', async (route) => { const response = await route.fetch(); held++; await gate; await route.fulfill({ response }); });
  try {
    await page.getByRole('button', { name: '开始生成' }).click(); await expect.poll(() => held).toBeGreaterThan(0);
    await page.getByRole('button', { name: '暂停派发' }).click(); await expect(page.locator('.batch-summary')).toContainText('批次已暂停');
    release(); await expect(page.locator('.batch-items > li').filter({ hasText: '保存中' })).toHaveCount(0);
    const last = page.locator('.batch-items > li').filter({ hasText: 'pause-4.png' }); await expect(last).toContainText('待处理');
    await last.getByRole('button', { name: '取消此项' }).click(); await expect(last).toContainText('已取消');
    await page.getByRole('button', { name: '继续', exact: true }).click(); await expect(page.locator('.batch-summary')).toContainText('批次已完成');
    await expect(page.locator('.batch-items input[type=checkbox]')).toHaveCount(3);
    await last.getByRole('button', { name: '重试', exact: true }).click(); await expect(page.locator('.batch-items input[type=checkbox]')).toHaveCount(4);
  } finally { release(); }
});

test('50 项发布清单在短视口内滚动，取消后保留选择且不发布', async ({ page }, info) => {
  await login(page);
  await page.getByLabel('选择图片', { exact: true }).setInputFiles(Array.from({ length: 50 }, (_, index) => image(`maximum-${index}.png`)));
  await smallDefault(page); await page.getByRole('button', { name: '开始生成' }).click();
  const choices = page.locator('.batch-items input[type=checkbox]');
  await expect(choices).toHaveCount(50);
  for (const choice of await choices.all()) await choice.check();
  let publications = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/publish')) publications++; });
  const opener = page.getByRole('button', { name: /发布已勾选草稿/ });
  await page.setViewportSize({ width: 350, height: 400 }); await opener.click();
  const dialog = page.getByRole('dialog', { name: '发布已勾选草稿', exact: true });
  await expect(dialog.locator('li')).toHaveCount(50);
  const bounds = await dialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(16);
  expect(bounds!.height).toBeLessThanOrEqual(368);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(384);
  await dialog.locator('li').first().scrollIntoViewIfNeeded(); await expect(dialog.locator('li').first()).toBeInViewport();
  if (info.project.name === 'chromium') await page.screenshot({ path: resolve('.scratch/site-ux/batch-maximum-350.png') });
  await dialog.locator('li').last().scrollIntoViewIfNeeded(); await expect(dialog.locator('li').last()).toBeInViewport();
  const confirmation = dialog.getByRole('checkbox');
  await expect(confirmation).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: '确认公开所选草稿' })).toBeDisabled();
  await confirmation.check();
  await expect(dialog.getByRole('button', { name: '确认公开所选草稿' })).toBeEnabled();
  await dialog.getByRole('button', { name: '返回草稿' }).click();
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await expect(page.locator('.batch-items input[type=checkbox]:checked')).toHaveCount(50);
  await page.setViewportSize({ width: 1440, height: 844 }); await opener.click();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(576);
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  expect(publications).toBe(0);
});

test('批次准备、裁剪、实际草稿和发布确认在五宽度下可访问且不溢出', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium');
  await login(page); await page.getByLabel('选择图片', { exact: true }).setInputFiles(image('width-check.png')); await smallDefault(page);
  const inspect = async (scene: string) => {
    for (const width of [350, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${scene} ${width}`).toBeLessThanOrEqual(width);
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.filter((entry) => ['serious', 'critical'].includes(entry.impact ?? '')).map((entry) => ({ id: entry.id, nodes: entry.nodes.map((node) => node.target) }))).toEqual([]);
      if ([350, 1440].includes(width)) await page.screenshot({ path: resolve(`.scratch/site-ux/batch-${scene}-${width}.png`), fullPage: true });
    }
  };
  await page.getByLabel('选择图片', { exact: true }).focus();
  expect(await page.locator('.batch-select-files').evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('2px');
  await inspect('prepare'); await page.getByRole('button', { name: '预览并裁剪' }).click();
  await expect(page.getByRole('dialog', { name: '裁剪图片', exact: true })).toBeVisible(); await inspect('crop');
  await page.getByRole('button', { name: '确认并更新' }).click(); await page.getByRole('button', { name: '开始生成' }).click();
  await expect(page.locator('.batch-items input[type=checkbox]')).toBeVisible(); await inspect('draft');
  await page.locator('.batch-items input[type=checkbox]').check(); await page.getByRole('button', { name: /发布已勾选草稿/ }).click(); await inspect('confirm');
  await page.setViewportSize({ width: 350, height: 400 });
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认公开所选草稿' }).scrollIntoViewIfNeeded();
  const bounds = await page.getByRole('button', { name: '确认公开所选草稿' }).boundingBox(); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(400);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});
