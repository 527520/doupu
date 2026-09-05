import { chromium, firefox, webkit, expect } from '@playwright/test';

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ baseURL: 'https://127.0.0.1:3443', ignoreHTTPSErrors: true });
    await context.addCookies([{ name: 'doupu_analytics_consent', value: 'denied', url: 'https://127.0.0.1:3443', secure: true, sameSite: 'Lax' }]);
    const first = await context.newPage(); const second = await context.newPage();
    await first.goto('/privacy'); await second.goto('/privacy');
    const a = first.getByRole('region', { name: '匿名分析偏好' });
    const b = second.getByRole('region', { name: '匿名分析偏好' });
    let release; const held = new Promise((resolve) => { release = resolve; });
    let intercepted = false;
    await second.route('**/api/analytics/consent', async (route) => { intercepted = true; await held; await route.continue(); });
    await b.getByRole('button', { name: '同意', exact: true }).click();
    await expect.poll(() => intercepted).toBe(true);
    await first.bringToFront();
    await first.evaluate(() => window.dispatchEvent(new Event('focus')));
    await a.getByRole('button', { name: '撤回并清除原始数据' }).click();
    await expect(a).toContainText('等待清除确认');
    expect((await context.cookies()).find((cookie) => cookie.name === 'doupu_analytics_consent')?.value).toBe('withdrawn');
    release();
    await expect(a.getByRole('status')).toContainText('已撤回同意并清除');
    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name === 'doupu_analytics_consent')?.value).toBe('denied');
    expect(cookies.some((cookie) => cookie.name === 'doupu_visitor')).toBe(false);
    await second.bringToFront();
    await second.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(b).toContainText('当前状态：已拒绝');
    console.log(JSON.stringify({ browser: name, delayedGrantThenWithdrawal: true, noVisitorCookie: true }));
    await context.close();
  } finally { await browser.close(); }
}
