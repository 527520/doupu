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
 * 等待水合完成：Next Dev Tools 按钮是客户端专属渲染，出现即代表 React 已接管 DOM。
 * （生产环境无此按钮，E2E 仅在 dev 下运行。）
 */
export async function waitHydrated(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Next\.js Dev Tools/ }).waitFor({ timeout: 15_000 }).catch(() => {
    // 某些页面可能未渲染 dev 覆盖层按钮——回退为 readyState 检查
  });
  await page.waitForFunction(() => document.readyState === 'complete');
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
