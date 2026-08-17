const { accessSync, constants } = require('node:fs');
const { chromium, firefox, webkit } = require('@playwright/test');

/** @typedef {{ name: string, executablePath: string }} BrowserInstallation */

/**
 * @param {BrowserInstallation[]} browsers
 * @param {(path: string) => boolean} [exists]
 * @returns {string[]}
 */
function findMissingBrowsers(browsers, exists = executableExists) {
  return browsers.filter((browser) => !exists(browser.executablePath)).map((browser) => browser.name);
}

/**
 * @param {BrowserInstallation[]} [browsers]
 * @param {(path: string) => boolean} [exists]
 */
function assertPlaywrightBrowsersInstalled(browsers = installedBrowserPaths(), exists = executableExists) {
  const missing = findMissingBrowsers(browsers, exists);
  if (missing.length === 0) return;
  throw new Error(
    `Playwright 浏览器未安装或不可执行：${missing.join(', ')}\n` +
      '请先运行：npx playwright install chromium firefox webkit',
  );
}

/** @returns {BrowserInstallation[]} */
function installedBrowserPaths() {
  return [
    { name: 'chromium', executablePath: chromium.executablePath() },
    { name: 'firefox', executablePath: firefox.executablePath() },
    { name: 'webkit', executablePath: webkit.executablePath() },
  ];
}

/** @param {string} path */
function executableExists(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = { assertPlaywrightBrowsersInstalled, findMissingBrowsers };

if (require.main === module) {
  try {
    assertPlaywrightBrowsersInstalled();
    console.log('Playwright browsers ready: chromium, firefox, webkit');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
