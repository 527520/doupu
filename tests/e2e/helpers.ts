/**
 * E2E 辅助工具：
 * - 从 dev 服务器日志读取 [dev-mail] 邮件链接（开发邮件假实现打印到 stdout）；
 * - 注册/验证/登录的便捷封装。
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

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

/**
 * 从日志中提取指定类型的邮件链接（轮询，最多 15s）。
 * kind: 'verify' | 'reset'，对应链接路径 /verify-email 与 /reset-password。
 */
export async function waitForMailLink(kind: 'verify' | 'reset', email: string): Promise<string> {
  const pathPrefix = kind === 'verify' ? '/verify-email?token=' : '/reset-password?token=';
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const log = readDevLog();
    const lines = log.split(/\r?\n/);
    // 找到发给该邮箱的那封邮件，再取其后的链接
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(email)) {
        for (let j = i; j < Math.min(i + 15, lines.length); j++) {
          const match = lines[j].match(new RegExp(`(http://[^\\s]+${pathPrefix.replace('?', '\\?')}[^\\s]+)`));
          if (match) return match[1].replace('http://localhost', BASE_URL);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`未在 dev 日志中找到发送给 ${email} 的 ${kind} 链接`);
}

/** 注册并完成邮箱验证；返回已登录的 page。 */
export async function registerAndLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码', { exact: false }).first().fill(password);
  await page.getByLabel('确认密码').fill(password);
  await page.getByRole('button', { name: /注册/ }).click();
  await page.waitForURL(/\/login/);

  const link = await waitForMailLink('verify', email);
  await page.goto(link);
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/login/);

  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码', { exact: false }).first().fill(password);
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/designs|\/app|\//);
}
