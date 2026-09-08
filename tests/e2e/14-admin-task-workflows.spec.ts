import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DEFAULT_GENERATION_PARAMS } from '../../src/lib/types';
import { fillField, selectChoice, uploadDraftOriginal } from './helpers';

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
  await uploadDraftOriginal(page, draft.revisionId);
  await post(page, `/api/admin/batches/${batch.id}/publish`, { revisionIds: [draft.revisionId], expectedVersion: batch.version, reason: '本地治理任务公开夹具' });
  return draft.workId as string;
}

test('每个后台任务页的键盘跳转都定位到主内容', async ({ page, browserName }) => {
  await login(page, '/admin/comments');
  // WebKit ships Safari's form-controls-only Tab order. macOS honours Option+Tab to
  // include links (Playwright's page-focus.spec.ts asserts this on darwin only); the
  // Windows/Linux ports expose no such override, so there Tab can never reach an <a>
  // and we focus the skip link directly, still verifying activation lands on main.
  const tabReachesLinks = browserName !== 'webkit' || process.platform === 'darwin';
  for (const section of ['comments', 'reports', 'tags', 'users', 'batches']) {
    await page.goto(`/admin/${section}`);
    await expect(page.locator('main#main')).toHaveCount(1);
    const skip = page.locator('a[href="#main"]');
    if (tabReachesLinks) await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    else await skip.focus();
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/admin/${section}#main$`));
    await expect(page.locator('main#main')).toBeInViewport();
  }
});

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
  await page.getByRole('button', { name: '新建标签', exact: true }).click();
  await page.getByLabel('标签名称', { exact: true }).fill(name);
  await page.getByLabel('操作理由').fill('人工核对的正式分类');
  await page.locator('.admin-task-detail').getByRole('button', { name: '新建标签', exact: true }).click();
  await expect(page.getByLabel('标签名称', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试确认上次操作' }).click();
  await expect(page.locator('.admin-object-list button').filter({ hasText: name })).toHaveCount(1);
  expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]);
  await page.locator('.admin-object-list button').filter({ hasText: name }).click();
  await page.getByLabel('标签名称', { exact: true }).fill(`新${name}`);
  await page.getByLabel('操作理由').fill('更新名称并暂时停用');
  await page.getByRole('switch', { name: '启用', exact: true }).uncheck();
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('.admin-object-list button').filter({ hasText: `新${name}` })).toContainText('停用');
  const target = await post(page, '/api/admin/community/tags', { name: `归档 ${suffix}`, slug: `target-${suffix}`, reason: '归并重复分类', expectedVersion: 0 });
  await page.reload();
  await page.locator('.admin-object-list button').filter({ hasText: `新${name}` }).click();
  await page.getByLabel('操作理由').fill('核对后合并到具名目标');
  await page.getByText('合并重复标签', { exact: true }).click();
  expect(target.id).toBeTruthy();
  await selectChoice(page,'合并到标签',`归档 ${suffix}`);
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
    await page.getByLabel('再次输入该账号编号以确认').fill(userId);
    await page.getByRole('button', { name: '暂停账号' }).click();
    await expect(entry).toContainText('已暂停');
    expect(await targetPage.evaluate(async () => (await fetch('/api/auth/me')).status)).toBe(401);
    await entry.click(); await page.getByLabel('操作理由').fill('验证完成恢复账号'); await page.getByLabel('再次输入该账号编号以确认').fill(userId);
    await page.getByRole('button', { name: '恢复账号' }).click(); await expect(entry).toContainText('正常');
    for (const role of ['moderator', 'user']) {
      await entry.click(); await page.getByLabel('操作理由').fill('核对角色调整与会话撤销'); await page.getByLabel('再次输入该账号编号以确认').fill(userId);
      await selectChoice(page,'调整为',role==='moderator'?'审核员':'用户'); await page.getByRole('button', { name: '确认调整角色' }).click();
      await expect(entry).toContainText(role === 'moderator' ? '审核员' : '用户');
    }
  } finally { await targetContext.close(); }
});

test('被内容安全拦截的评论不公开但进入治理队列，可复核后公开', async ({ page, browser, baseURL }, info) => {
  const workId = (await (await page.request.get('/api/community/works')).json()).items[0].id as string;
  const body = `含 E2E拦截词 的评论 ${info.project.name}`;
  const authorContext = await browser.newContext({ baseURL });
  try {
    const author = await authorContext.newPage();
    // 专用账号：共用的 e2e-user 在整轮里评论过多会触发突发限流（转人工），掩盖这里要验证的拦截判定。
    await author.goto('/login?next=/community'); await fillField(author, '邮箱', `e2e-comment-${info.project.name}@example.com`); await fillField(author, '密码', 'E2e-pass-123!');
    await author.getByRole('button', { name: '登录', exact: true }).click(); await expect.poll(() => new URL(author.url()).pathname).toBe('/community');
    const response = await author.evaluate(async ({ workId, body }) => {
      const reply = await fetch(`/api/community/works/${workId}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) });
      return { status: reply.status, body: await reply.json() };
    }, { workId, body });
    expect(response.status).toBe(422); expect(response.body.error.code).toBe('COMMENT_BLOCKED');
    const listed = await author.evaluate(async (workId) => (await (await fetch(`/api/community/works/${workId}/comments`)).json()).items, workId);
    expect(JSON.stringify(listed)).not.toContain('E2E拦截词');
  } finally { await authorContext.close(); }
  await login(page, '/admin/comments');
  const entry = page.locator('.review-queue button').filter({ hasText: 'E2E拦截词' }).filter({ hasText: info.project.name });
  await entry.click();
  await expect(page.locator('.review-preview')).toContainText('已拦截');
  await expect(page.locator('.review-preview')).toContainText('服务建议拦截');
  await expect(page.getByRole('button', { name: '隐藏', exact: true })).toHaveCount(0);
  await page.getByLabel('处置理由').fill('复核确认为误判');
  await page.getByRole('button', { name: '复核后公开' }).click();
  await expect(page.locator('.review-actions')).toContainText('操作已完成');
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
  await page.getByLabel('搜索记录').fill('community'); await page.getByRole('button', { name: '查询' }).click();
  await page.locator('.admin-object-list button').first().click();
  await expect(page.getByRole('heading', { name: '操作前', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: '操作后', exact: true })).toBeVisible();
  await page.goto('/admin/analytics?start=invalid'); await expect(page.locator('main [role=alert]')).toContainText('部分查询条件无效');
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
