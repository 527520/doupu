/**
 * E2E 全局设置：启动 Next 16 Turbopack dev 服务器，
 * 捕获 stdout 到日志文件——dev 邮件假实现把验证/重置链接打印到 stdout，测试从中读取。
 * 数据库：不设置 DATABASE_URL → 服务启动钩子初始化进程内 PGlite（每轮测试全新库）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPlaywrightBrowsersInstalled } from './checkBrowsers.cjs';
import { E2E_PORT, stopProcessTree } from './serverProcess';

// 日志放系统临时目录：dev 服务器监听项目内文件，日志写入会触发 Fast Refresh 全量重载
const LOG_PATH = join(tmpdir(), 'doupu-e2e-dev.log');
const READY_URL = `http://127.0.0.1:${E2E_PORT}/api/auth/me`;

let server: ChildProcess | null = null;

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(READY_URL, { method: 'GET' });
      // /api/auth/me 未登录返回 401 即说明服务器与路由已就绪
      if (response.status === 401 || response.status === 200) return;
    } catch {
      // 尚未就绪，继续轮询
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('E2E dev server did not become ready within 180s');
}

export default async function globalSetup(): Promise<void> {
  // 在启动应用前失败，避免跑到某个 project 才报 browser executable missing。
  assertPlaywrightBrowsersInstalled();
  writeFileSync(LOG_PATH, '', 'utf8'); // 清空旧日志（每次运行全新会话）

  const logStream = createWriteStream(LOG_PATH, { flags: 'a' });
  // 直接以 node 启动 next CLI（避免 npx/.cmd 在跨平台与沙箱下的解析差异）
  const nextBin = require.resolve('next/dist/bin/next');
  server = spawn(
    process.execPath,
    [nextBin, 'dev', '-p', String(E2E_PORT)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(E2E_PORT),
        NEXT_TELEMETRY_DISABLED: '1',
        // 显式移除 DATABASE_URL → PGlite 回退
        DATABASE_URL: '',
        // 回退库退回内存（不落盘）：每轮 E2E 全新库，且不与本地 dev 的 .pglite-dev 竞争
        PGLITE_DATA_DIR: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      // Unix teardown 通过负 PID 终止整个进程组；Windows 由 taskkill /T 处理进程树。
      detached: process.platform !== 'win32',
    },
  );
  server.stdout!.pipe(logStream);
  server.stderr!.pipe(logStream);

  process.env.E2E_DEV_LOG = LOG_PATH;
  process.env.E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
  process.env.E2E_SERVER_PID = String(server.pid);

  try {
    await waitForServer();
  } catch (error) {
    if (server.pid) await stopProcessTree(server.pid, E2E_PORT).catch(() => undefined);
    throw error;
  }

  // 预热：逐个请求关键路由，触发 Turbopack 编译，避免测试期首次编译争用
  const warmRoutes = ['/', '/app', '/register', '/login', '/verify-email', '/forgot-password', '/designs', '/palettes', '/help', '/about'];
  for (const route of warmRoutes) {
    try {
      await fetch(`http://127.0.0.1:${E2E_PORT}${route}`, { method: 'GET' });
    } catch {
      // 忽略预热失败（路由缺失等）
    }
  }
  console.log('[e2e] dev server ready and warmed');
}
