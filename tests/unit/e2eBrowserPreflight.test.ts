import { describe, expect, it } from 'vitest';
import {
  assertPlaywrightBrowsersInstalled,
  findMissingBrowsers,
} from '../e2e/checkBrowsers.cjs';

const browsers = [
  { name: 'chromium', executablePath: '/cache/chromium' },
  { name: 'firefox', executablePath: '/cache/firefox' },
  { name: 'webkit', executablePath: '/cache/webkit' },
];

describe('Playwright browser preflight', () => {
  it('reports every missing browser before E2E starts', () => {
    const missing = findMissingBrowsers(browsers, (path: string) => path !== '/cache/firefox');
    expect(missing).toEqual(['firefox']);
    expect(() =>
      assertPlaywrightBrowsersInstalled(browsers, (path: string) => path !== '/cache/firefox'),
    ).toThrow(/firefox[\s\S]*npx playwright install chromium firefox webkit/);
  });

  it('accepts a complete three-browser installation', () => {
    expect(findMissingBrowsers(browsers, () => true)).toEqual([]);
    expect(() => assertPlaywrightBrowsersInstalled(browsers, () => true)).not.toThrow();
  });
});
