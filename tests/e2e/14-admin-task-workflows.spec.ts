import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DEFAULT_GENERATION_PARAMS } from '../../src/lib/types';
import { fillField } from './helpers';

async function login(page: Page, next: string, email = 'e2e-admin@example.com') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await fillField(page, '邮箱', email); await fillField(page, '密码', 'E2e-pass-123!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replaceAll('/', '\\/')}$`));
  await expect(page.locator('h1')).toBeVisible();
}
async function post(page: Page, url: string, body: unknown) {
  const result = await page.evaluate(async ({ url, body, key }) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { url, body, key: randomUUID() });
  expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
  return result.body;
}
async function fixtureWork(page: Page, title: string) {
  const batch = await post(page, '/api/admin/batches', { itemCount: 1, defaultParams: DEFAULT_GENERATION_PARAMS, engineVersion: 'e2e', reason: '本地治理任务夹具' });
  const draft = await post(page, `/api/admin/batches/${batch.id}/drafts`, { title, reason: '本地治理任务夹具', snapshot: {
    version: 1, engineVersion: 'e2e', boardProfile: '5mm-29', paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 }, params: { ...DEFAULT_GENERATION_PARAMS, backgroundPrototype: null },
    pattern: { width: 1, height: 1, cells: [{ hex: '#FAF4C8', code: 'A01', transparent: false }] },
  } });
  await post(page, `/api/admin/batches/${batch.id}/publish`, { revisionIds: [draft.revisionId], expectedVersion: batch.version, reason: '本地治理任务公开夹具' });
  return draft.workId as string;
}

test('标签创建丢响应同键恢复，改名停用及具名合并可完成', async ({ page }, info) => {
  await login(page, '/admin/tags');
  const suffix = `${info.project.name}-${randomUUID().slice(0, 6)}`;
  const name = `分类 ${suffix}`;
  const writes: Array<{ key: string | null; body: string | null }> = [];
  let loseReply = true;
  await page.route('**/api/admin/community/tags', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    writes.push({ key: route.request().headers()['idempotency-key'] ?? null, body: route.request().postData() });
    const response = await route.fetch();
    if (loseReply) { loseReply = false; await route.fulfill({ status: 503, json: { error: { message: '本地模拟提交后丢失响应' } } }); }
    else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '创建标签', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill(name);
  await page.getByLabel('链接标识').fill(`tag-${suffix}`);
  await page.getByLabel('操作理由').fill('人工核对的正式分类');
  await page.locator('.admin-task-detail').getByRole('button', { name: '创建标签', exact: true }).click();
  await expect(page.getByLabel('名称', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试确认上次操作' }).click();
  await expect(page.locator('.admin-object-list button').filter({ hasText: name })).toHaveCount(1);
  expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]);
  await page.locator('.admin-object-list button').filter({ hasText: name }).click();
  await page.getByLabel('名称', { exact: true }).fill(`新${name}`);
  await page.getByLabel('操作理由').fill('更新名称并暂时停用');
  await page.getByRole('checkbox', { name: '启用', exact: true }).uncheck();
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('.admin-object-list button').filter({ hasText: `新${name}` })).toContainText('停用');
  const target = await post(page, '/api/admin/community/tags', { name: `归档 ${suffix}`, slug: `target-${suffix}`, reason: '归并重复分类', expectedVersion: 0 });
  await page.reload();
  await page.locator('.admin-object-list button').filter({ hasText: `新${name}` }).click();
  await page.getByLabel('操作理由').fill('核对后合并到具名目标');
  await page.getByText('合并重复标签', { exact: true }).click();
  await page.getByLabel('合并到标签').selectOption(target.id);
  await expect(page.getByRole('button', { name: '确认合并标签' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /我确认将/ }).check();
  await page.getByRole('button', { name: '确认合并标签' }).click();
  await expect(page.locator('.admin-object-list button').filter({ hasText: `新${name}` })).toContainText('已合并');
});

test('人员二次确认、暂停撤销会话、恢复与角色调整可完成', async ({ page, browser, baseURL }, info) => {
  const email = `e2e-governance-${info.project.name}@example.com`;
  const targetContext = await browser.newContext({ baseURL });
  try {
    const targetPage = await targetContext.newPage();
    await login(targetPage, '/account', email);
    await login(page, '/admin/users');
    await page.getByLabel('搜索账号').fill(email);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    const entry = page.locator('.admin-object-list button').filter({ hasText: `E2E 治理目标 ${info.project.name}` });
    await entry.click();
    const userId = await page.locator('.admin-facts dd').first().innerText();
    await page.getByLabel('操作理由').fill('本地验证暂停会话失效');
    await expect(page.getByRole('button', { name: '暂停账号' })).toBeDisabled();
    await page.getByLabel('目标 userId 二次确认').fill(userId);
    await page.getByRole('button', { name: '暂停账号' }).click();
    await expect(entry).toContainText('已暂停');
    expect(await targetPage.evaluate(async () => (await fetch('/api/auth/me')).status)).toBe(401);
    await entry.click(); await page.getByLabel('操作理由').fill('验证完成恢复账号'); await page.getByLabel('目标 userId 二次确认').fill(userId);
    await page.getByRole('button', { name: '恢复账号' }).click(); await expect(entry).toContainText('正常');
    for (const role of ['moderator', 'user']) {
      await entry.click(); await page.getByLabel('操作理由').fill('核对角色调整与会话撤销'); await page.getByLabel('目标 userId 二次确认').fill(userId);
      await page.getByLabel('调整为角色').selectOption(role); await page.getByRole('button', { name: '确认调整角色' }).click();
      await expect(entry).toContainText(role === 'moderator' ? '审核员' : '用户');
    }
  } finally { await targetContext.close(); }
});

test('规则从当前完整版本编辑，显式处理过期版本后再启用', async ({ page }, info) => {
  await login(page, '/admin/rules');
  await page.getByRole('button', { name: '基于当前版本编辑' }).click();
  const word = `E2E新增词${info.project.name}`;
  await page.getByLabel('字面词', { exact: true }).fill(word); await page.getByRole('button', { name: '加入版本' }).click();
  await page.getByLabel('启用理由').fill('核对完整规则版本');
  await expect(page.getByRole('button', { name: '创建并启用不可变版本' })).toBeDisabled();
  const current = await page.evaluate(async () => { const data = await (await fetch('/api/admin/moderation-rules')).json(); return data.items.find((item: { active: boolean }) => item.active); });
  await post(page, '/api/admin/moderation-rules', { rules: [...current.rules, { literal: `E2E并行词${info.project.name}`, category: 'spam', risk: 'review' }], expectedVersion: current.version, reason: '模拟另一个管理员先更新' });
  await page.getByRole('checkbox', { name: /我已核对全部词条/ }).check();
  await page.getByRole('button', { name: '创建并启用不可变版本' }).click();
  await expect(page.locator('.admin-task-notice')).toContainText('规则版本已变化');
  await expect(page.getByLabel('启用理由')).toHaveValue('核对完整规则版本');
  await page.locator('.admin-task-notice').getByRole('button', { name: '刷新对象状态' }).click();
  await page.getByRole('button', { name: '放弃当前编辑并载入最新词表' }).click();
  await expect(page.getByRole('checkbox', { name: /我已核对全部词条/ })).not.toBeChecked();
  await page.getByLabel('字面词', { exact: true }).fill(word); await page.getByRole('button', { name: '加入版本' }).click();
  await page.getByLabel('启用理由').fill('重新核对完整规则版本'); await page.getByRole('checkbox', { name: /我已核对全部词条/ }).check();
  await page.getByRole('button', { name: '创建并启用不可变版本' }).click();
  await expect(page.locator('.admin-task-queue .admin-rule-list').first()).toContainText(word);
});

test('具名作品下架恢复与评论锁不绕过内容核查和确认', async ({ page }, info) => {
  await login(page, '/admin/works');
  const title = `E2E管理作品${info.project.name}`;
  const workId = await fixtureWork(page, title);
  await page.goto(`/admin/works?work=${workId}`);
  const detail = page.locator('.admin-task-detail');
  await expect(detail.locator('canvas').first()).toBeVisible();
  await page.getByLabel('操作理由').fill('核对作品后管理评论');
  await page.getByRole('button', { name: '锁定评论' }).click();
  await page.locator('.admin-object-list button').filter({ hasText: title }).click();
  await expect(detail).toContainText('评论已锁定');
  await page.getByLabel('操作理由').fill('核对后暂时下架作品');
  await page.getByRole('button', { name: '下架作品', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认下架作品' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /我已核对/ }).check(); await page.getByRole('button', { name: '确认下架作品' }).click();
  expect(await page.evaluate(async (id) => (await fetch(`/api/community/works/${id}`)).status, workId)).toBe(404);
  await page.locator('.admin-object-list button').filter({ hasText: title }).click();
  await page.getByLabel('操作理由').fill('复核已批准版本恢复'); await page.getByRole('button', { name: '恢复已批准版本' }).click();
  await page.getByRole('checkbox', { name: /我已核对/ }).check(); await page.getByRole('button', { name: '确认恢复作品' }).click();
  await expect(page.locator('.admin-object-list button').filter({ hasText: title })).toContainText('公开可见');
  expect(await page.evaluate(async (id) => (await fetch(`/api/community/works/${id}`)).status, workId)).toBe(200);
});

test('审计可检索与查看状态，分析无效筛选和系统未知证据明示', async ({ page }) => {
  await login(page, '/admin/audit');
  await page.getByLabel('搜索动作、目标 ID 或请求 ID').fill('community'); await page.getByRole('button', { name: '查询审计' }).click();
  await page.locator('.admin-object-list button').first().click();
  await expect(page.getByRole('heading', { name: '操作前状态' })).toBeVisible(); await expect(page.getByRole('heading', { name: '操作后状态' })).toBeVisible();
  await page.goto('/admin/analytics?start=invalid'); await expect(page.locator('main [role=alert]')).toContainText('部分查询参数无效');
  await page.getByRole('link', { name: '重置查询' }).click();
  await expect(page).toHaveURL(/\/admin\/analytics$/); await expect(page.locator('main [role=alert]')).toHaveCount(0);
  await expect(page.locator('.admin-advanced-filters')).not.toHaveAttribute('open');
  await page.goto('/admin/system'); await expect(page.getByText('数据库实际执行时间', { exact: true })).toBeVisible(); await expect(page.getByText('未接入', { exact: true })).toBeVisible();
});

test('举报先核查当前评论，隐藏内容和案件结案分别留痕', async ({ page, browser, baseURL }, info) => {
  await login(page, '/admin/reports');
  const workId = await fixtureWork(page, `E2E举报作品${info.project.name}`);
  const comment = await post(page, `/api/community/works/${workId}/comments`, { body: `E2E人工核查评论${info.project.name}` });
  const reporter = await browser.newContext({ baseURL });
  try {
    const reporterPage = await reporter.newPage(); await login(reporterPage, '/community', 'e2e-user@example.com');
    await post(reporterPage, '/api/community/reports', { targetType: 'comment', targetId: comment.id, category: 'spam', details: `E2E案件${info.project.name}` });
    await page.reload();
    const entry = page.locator('.review-queue button').filter({ hasText: '评论 / 垃圾推广' }).first();
    await entry.click(); await expect(page.locator('.report-material')).toContainText(`E2E人工核查评论${info.project.name}`);
    await page.getByLabel('处置理由').fill('受理并核查当前评论'); await page.getByRole('button', { name: '受理', exact: true }).click();
    await entry.click(); await page.getByLabel('处置理由').fill('核对当前版本后隐藏');
    await page.getByRole('button', { name: '隐藏当前评论版本' }).click();
    await expect(page.locator('.report-material')).toContainText('已隐藏');
    await expect(page.getByRole('button', { name: '结案', exact: true })).toBeDisabled();
    const comments = await reporterPage.evaluate(async (id) => (await (await fetch(`/api/community/works/${id}/comments`)).json()).items, workId);
    expect(comments.some((item: { id: string }) => item.id === comment.id)).toBe(false);
    await page.getByLabel('处置理由').fill('内容已隐藏，记录人工结案'); await page.getByRole('button', { name: '结案', exact: true }).click();
    await expect(page.locator('.admin-task-notice, .review-actions').getByText('操作已完成。')).toBeVisible();
  } finally { await reporter.close(); }
});
