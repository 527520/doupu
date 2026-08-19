/**
 * E2E 核心旅程 4：设计云端同步（spec §F8）。
 * 登录 → 工作台保存设计 → 设计列表出现 → 第二个浏览器上下文登录同账号 →
 * 拉取到同一设计（LWW 云端同步）。
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { fillField, uniqueEmail, waitForMailLink } from './helpers';

const PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png');

async function registerAndVerifyInContext(
  context: import('@playwright/test').BrowserContext,
): Promise<{ email: string; password: string }> {
  const email = uniqueEmail('sync');
  const password = 'sync-password-123';
  const page = await context.newPage();
  await page.goto('/register');
  await fillField(page, '邮箱', email);
  await fillField(page, '密码', password);
  await fillField(page, '确认密码', password);
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.getByText(/验证邮件已发送/).first()).toBeVisible({ timeout: 15_000 });
  const link = await waitForMailLink('verify', email);
  await page.goto(link);
  await expect(page.getByText(/邮箱验证成功/).first()).toBeVisible({ timeout: 10_000 });
  await page.close();
  return { email, password };
}

async function login(page: import('@playwright/test').Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await fillField(page, '邮箱', email);
  await fillField(page, '密码', password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(/\/designs|\/app/, { timeout: 15_000 });
}

/** 读取本机 IndexedDB 中第一条设计的 id（用于构造 /app?id=… 直链）。 */
async function firstDesignId(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('doupu');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const records = await new Promise<Array<{ id: string }>>((res, rej) => {
      const tx = db.transaction('designs', 'readonly');
      const r = tx.objectStore('designs').getAll();
      r.onsuccess = () => res(r.result as Array<{ id: string }>);
      r.onerror = () => rej(r.error);
    });
    return records.length > 0 ? records[0].id : null;
  });
}

async function localSyncSnapshot(page: import('@playwright/test').Page): Promise<{
  records: Array<{ id: string; revision?: number; syncState?: string }>;
  tombstones: Array<{ id: string; baseRevision: number }>;
}> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('doupu');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['designs', 'meta'], 'readonly');
    const recordsRequest = transaction.objectStore('designs').getAll();
    const tombstonesRequest = transaction.objectStore('meta').get('sync-tombstones-v2');
    const records = await new Promise<Array<{ id: string; revision?: number; syncState?: string }>>((resolve, reject) => {
      recordsRequest.onsuccess = () => resolve(recordsRequest.result as Array<{ id: string; revision?: number; syncState?: string }>);
      recordsRequest.onerror = () => reject(recordsRequest.error);
    });
    const raw = await new Promise<string | undefined>((resolve, reject) => {
      tombstonesRequest.onsuccess = () => resolve((tombstonesRequest.result as { value?: string } | undefined)?.value);
      tombstonesRequest.onerror = () => reject(tombstonesRequest.error);
    });
    return { records, tombstones: raw ? JSON.parse(raw) as Array<{ id: string; baseRevision: number }> : [] };
  });
}

test('双设备同步：设备 A 保存 → 设备 B 登录后可见同一设计', async ({ browser }) => {
  // 两个隔离的浏览器上下文模拟两台设备
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  const { email, password } = await registerAndVerifyInContext(contextA);

  // 设备 A：登录 → 工作台生成并保存
  const pageA = await contextA.newPage();
  await login(pageA, email, password);
  await pageA.goto('/app');
  await pageA.getByLabel('图片文件选择器').setInputFiles(PHOTO);
  await pageA.getByRole('button', { name: '确认裁剪' }).click({ timeout: 15_000 });
  await expect(pageA.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });
  await fillField(pageA, '设计名称', '云端同步测试设计');
  await pageA.getByRole('button', { name: /保存/ }).click();
  // 等待保存完成（IndexedDB 写入落盘）再导航，避免慢浏览器下写入被中断
  await expect(pageA.getByText(/已保存/).first()).toBeVisible({ timeout: 15_000 });

  // 设备 A 的设计列表出现该设计
  await pageA.goto('/designs');
  await expect(pageA.getByText('云端同步测试设计').first()).toBeVisible({ timeout: 15_000 });

  // 设备 B：登录 → 设计列表可见同一设计
  const pageB = await contextB.newPage();
  await login(pageB, email, password);
  await pageB.goto('/designs');
  await expect(pageB.getByText('云端同步测试设计').first()).toBeVisible({ timeout: 15_000 });

  await contextA.close();
  await contextB.close();
});

test('删除跨设备收敛：A 删除后列表消失、刷新仍在、直链打不开、B 也看不到', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const { email, password } = await registerAndVerifyInContext(contextA);

  // 设备 A：登录 → 生成并保存设计
  const pageA = await contextA.newPage();
  await login(pageA, email, password);
  await pageA.goto('/app');
  await pageA.getByLabel('图片文件选择器').setInputFiles(PHOTO);
  await pageA.getByRole('button', { name: '确认裁剪' }).click({ timeout: 15_000 });
  await expect(pageA.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });
  await fillField(pageA, '设计名称', '待删除设计');
  await pageA.getByRole('button', { name: /保存/ }).click();
  await expect(pageA.getByText(/已保存/).first()).toBeVisible({ timeout: 15_000 });
  const designId = await firstDesignId(pageA);
  expect(designId).toBeTruthy();

  // A：删除（此前 DELETE 被守卫 400 拦截导致删除失败——本用例守护该回归）
  await pageA.goto('/designs');
  await expect(pageA.getByText('待删除设计').first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await localSyncSnapshot(pageA)).records.find((record) => record.id === designId)).toMatchObject({
    revision: 1,
    syncState: 'synced',
  });
  await pageA.getByRole('button', { name: '删除' }).first().click();
  await pageA.getByRole('dialog').getByRole('button', { name: '删除' }).click();
  await expect.poll(async () => await localSyncSnapshot(pageA)).toMatchObject({ records: [], tombstones: [] });
  await expect(pageA.getByText('待删除设计')).toHaveCount(0, { timeout: 15_000 });
  await expect(pageA.getByText('加载失败')).toHaveCount(0);

  // A：刷新后仍不出现；直链打开 → 上传页（打不开已删设计）
  await pageA.reload();
  await expect(pageA.getByText('待删除设计')).toHaveCount(0, { timeout: 15_000 });
  await pageA.goto(`/app?id=${designId}`);
  await expect(pageA.getByRole('button', { name: '选择图片文件' })).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByLabel('设计名称')).toHaveCount(0);

  // 设备 B：删除已同步——列表为空，直链同样打不开
  const pageB = await contextB.newPage();
  await login(pageB, email, password);
  await pageB.goto('/designs');
  await expect(pageB.getByText('待删除设计')).toHaveCount(0, { timeout: 15_000 });
  await pageB.goto(`/app?id=${designId}`);
  await expect(pageB.getByRole('button', { name: '选择图片文件' })).toBeVisible({ timeout: 15_000 });
  await expect(pageB.getByLabel('设计名称')).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

test('越权防护：他人设计的 id 直链打不开（本地无副本 → 上传页，云端 GET 404）', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  // 用户 A 创建并保存一个设计，取它的 id
  const accountA = await registerAndVerifyInContext(contextA);
  const pageA = await contextA.newPage();
  await login(pageA, accountA.email, accountA.password);
  await pageA.goto('/app');
  await pageA.getByLabel('图片文件选择器').setInputFiles(PHOTO);
  await pageA.getByRole('button', { name: '确认裁剪' }).click({ timeout: 15_000 });
  await expect(pageA.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });
  await pageA.getByRole('button', { name: /保存/ }).click();
  await expect(pageA.getByText(/已保存/).first()).toBeVisible({ timeout: 15_000 });
  const designId = await firstDesignId(pageA);
  expect(designId).toBeTruthy();

  // 用户 B（另一账号）打开 A 的设计直链 → 看不到 A 的作品
  const accountB = await registerAndVerifyInContext(contextB);
  const pageB = await contextB.newPage();
  await login(pageB, accountB.email, accountB.password);
  await pageB.goto(`/app?id=${designId}`);
  await expect(pageB.getByRole('button', { name: '选择图片文件' })).toBeVisible({ timeout: 15_000 });
  await expect(pageB.getByLabel('设计名称')).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});
