import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';

const PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png');

test('an aging administrator can render read-only pages and renew the database and browser together', async ({ page, context }) => {
  const token = process.env.E2E_ADMIN_SESSION_TOKEN;
  const origin = process.env.E2E_BASE_URL;
  const connectionString = process.env.DATABASE_URL;
  if (!token || !origin || !connectionString) throw new Error('production session regression requires E2E_ADMIN_SESSION_TOKEN, E2E_BASE_URL and DATABASE_URL');
  if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('candidate session regression only accepts a local test server');
  const pool = new Pool({ connectionString, max: 1 });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  try {
    const before = (await pool.query('select expires_at from sessions where token_hash=$1', [tokenHash])).rows[0].expires_at as Date;
    expect(before.getTime() - Date.now()).toBeLessThan(15 * 24 * 60 * 60 * 1000);
    await context.addCookies([{ name: 'doupu_session', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const renewal = page.waitForResponse((response) => response.url().endsWith('/api/auth/me'));
    const rendered = await page.goto('/admin/analytics');
    expect(rendered?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: '匿名分析' })).toBeVisible();
    expect((await renewal).status()).toBe(200);
    const after = (await pool.query('select expires_at from sessions where token_hash=$1', [tokenHash])).rows[0].expires_at as Date;
    expect(after.getTime() - before.getTime()).toBeGreaterThan(15 * 24 * 60 * 60 * 1000);
    await expect.poll(async () => (await context.cookies()).find((cookie) => cookie.name === 'doupu_session')?.expires ?? 0)
      .toBeGreaterThan(after.getTime() / 1000 - 2);
    const cookie = (await context.cookies()).find((item) => item.name === 'doupu_session')!;
    expect(Math.abs(cookie.expires - after.getTime() / 1000)).toBeLessThan(2);
    await page.getByRole('link', { name: /系统信息/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '系统信息' })).toBeVisible();
  } finally { await pool.end(); }
});

test('standalone production CSP permits RSC navigation and the generation Worker', async ({ page }) => {
  const cspErrors: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/content security policy|violates the following directive|refused to/i.test(text)) cspErrors.push(text);
  });

  const home = await page.goto('/');
  const csp = home?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await page.goto('/');
  // D-3：首页「开始制作」链接已由真实上传落区取代——走首页落图交接进工作台，
  // 同样覆盖 RSC 客户端导航（/ → /app?new=1）。
  await page.getByLabel('图片文件选择器').setInputFiles(PHOTO);
  await expect(page).toHaveURL(/\/app/);
  await page.waitForFunction(() => document.documentElement.dataset.doupuHydrated === 'true');
  await expect(page.getByRole('button', { name: '裁剪图片', exact: true })).toBeEnabled();
  await expect(page.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: '裁剪图片', exact: true }).click();
  await page.getByLabel('裁剪选区画布').focus();
  await page.keyboard.press('Alt+Shift+ArrowLeft');
  await expect(page.getByRole('dialog', { name: '裁剪图片' })).toContainText('当前选区：54 × 64 像素');
  await page.getByRole('button', { name: '确认并更新' }).click();
  await expect(page.getByText(/共 11900 粒/).first()).toBeVisible();

  expect(cspErrors).toEqual([]);
});

test('standalone routes enforce PostgreSQL CAS and single-use token transactions', async ({ request }) => {
  const sessionToken = process.env.E2E_SESSION_TOKEN;
  const verifyToken = process.env.E2E_VERIFY_TOKEN;
  const origin = process.env.E2E_BASE_URL;
  if (!sessionToken || !verifyToken || !origin) {
    throw new Error('production PostgreSQL contract requires E2E_SESSION_TOKEN, E2E_VERIFY_TOKEN and E2E_BASE_URL');
  }
  const headers = {
    'content-type': 'application/json',
    origin,
    cookie: `doupu_session=${sessionToken}`,
  };
  const id = '00000000-0000-4000-8000-000000000108';
  const project = {
    format: 'doupu-project', version: 3, engineVersion: '2.0.0', boardProfile: '5mm-29', name: '并发设计',
    createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
    paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
    params: { targetWidth: 20, targetColorCount: 2, dithering: false, mode: 'dominant', brightness: 0, contrast: 0, backgroundRemoval: false, bgTolerance: 8 },
    pattern: { width: 1, height: 1, cells: [{ hex: '#000000', code: 'H07', transparent: false }] },
  };
  const put = (name: string) => request.put(`/api/designs/${id}`, {
    headers,
    data: { name, project: { ...project, name }, baseRevision: 0 },
  });
  const writes = await Promise.all([put('并发 A'), put('并发 B')]);
  expect(writes.map((response) => response.status()).sort()).toEqual([200, 409]);
  const stored = await request.get(`/api/designs/${id}`, { headers: { cookie: headers.cookie } });
  expect(stored.status()).toBe(200);
  expect((await stored.json()).revision).toBe(1);

  const consume = () => request.post('/api/auth/verify-email', {
    headers: { 'content-type': 'application/json', origin },
    data: { token: verifyToken },
  });
  const consumptions = await Promise.all([consume(), consume()]);
  expect(consumptions.map((response) => response.status()).sort()).toEqual([200, 400]);
});
