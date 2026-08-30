import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const PHOTO = resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png');

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
  await expect(page.getByRole('heading', { name: '裁剪图片' })).toBeVisible();
  await page.getByRole('button', { name: '确认裁剪' }).click();
  await expect(page.getByText(/共 \d+ 粒/).first()).toBeVisible({ timeout: 20_000 });

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
