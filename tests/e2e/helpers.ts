/**
 * E2E 辅助工具：
 * - 从 dev 服务器日志读取 [dev-mail] 邮件链接（开发邮件假实现打印到 stdout）；
 * - 抗水合竞态的填充/上传助手（WebKit 等慢浏览器上 React 挂载可能晚于首次交互）。
 */
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';

export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** 读取 dev 服务器日志内容。 */
export function readDevLog(): string {
  const path = process.env.E2E_DEV_LOG;
  if (!path) throw new Error('E2E_DEV_LOG not set（globalSetup 未运行？）');
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** 从日志中提取指定类型的邮件链接（轮询，最多 15s）。 */
export async function waitForMailLink(kind: 'verify' | 'reset', email: string): Promise<string> {
  const pathPrefix = kind === 'verify' ? '/verify-email?token=' : '/reset-password?token=';
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const log = readDevLog();
    const lines = log.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(email)) {
        for (let j = i; j < Math.min(i + 15, lines.length); j++) {
          const match = lines[j].match(new RegExp(`(http://[^\\s]+${pathPrefix.replace('?', '\\?')}[^\\s]+)`));
          if (match) return match[1].replace('http://localhost:3000', BASE_URL);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`未在 dev 日志中找到发送给 ${email} 的 ${kind} 链接`);
}

/**
 * 等待水合完成：应用根布局的客户端 effect 会设置稳定标记。
 * 非应用页面（例如 setContent 的辅助测试）只需等待 readyState。
 */
export async function waitHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => document.readyState === 'complete');
  if (page.url().startsWith(BASE_URL)) {
    await page.waitForFunction(() => document.documentElement.dataset.doupuHydrated === 'true', undefined, { timeout: 15_000 });
  }
}

/**
 * 抗水合填充：先等水合完成再填充，并断言值生效。
 */
export async function fillField(
  page: Page,
  label: string | RegExp,
  value: string,
  opts: { exact?: boolean } = {},
): Promise<void> {
  await waitHydrated(page);
  await expect(async () => {
    const input = page.getByLabel(label, { exact: opts.exact ?? false }).first();
    await input.fill(value);
    expect(await input.inputValue()).toBe(value);
  }).toPass({ timeout: 15_000 });
}

/**
 * 用真实键盘输入替换数字输入框（spinbutton）的值并断言生效（带重试）。
 * Firefox 下 Playwright fill 对受控输入偶发不触发 React onChange（DOM 值变、
 * React 状态没变 → blur 提交读到旧值 → 防抖去重吞掉变更）；逐字键入走原生
 * 键盘路径，每个字符都会触发 onChange，与人类输入一致。配合调用方 blur 提交。
 */
export async function typeSpin(page: Page, name: string, value: string): Promise<void> {
  await waitHydrated(page);
  await expect(async () => {
    const input = page.getByRole('spinbutton', { name }).first();
    await input.click();
    await input.press('ControlOrMeta+A');
    await input.pressSequentially(value);
    expect(await input.inputValue()).toBe(value);
  }).toPass({ timeout: 15_000 });
}

/** 抗水合上传：先等水合完成再 setInputFiles，并断言出现响应。 */
export async function uploadFile(page: Page, filePath: string): Promise<void> {
  await waitHydrated(page);
  await expect(async () => {
    await page.getByLabel('图片文件选择器').setInputFiles(filePath);
    await expect(
      page.getByText(/正在读取|正在解码|正在转换|不支持|无法解析|裁剪图片|松开以添加/).first(),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
