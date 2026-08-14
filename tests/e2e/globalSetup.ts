/**
 * E2E 全局设置：启动 Next dev 服务器（webpack 模式，保证 instrumentation 可用），
 * 捕获 stdout 到日志文件——dev 邮件假实现把验证/重置链接打印到 stdout，测试从中读取。
 * 数据库：不设置 DATABASE_URL → 服务启动钩子初始化进程内 PGlite（每轮测试全新库）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3100;
// 日志放系统临时目录：dev 服务器监听项目内文件，日志写入会触发 Fast Refresh 全量重载
const LOG_PATH = join(tmpdir(), 'doupu-e2e-dev.log');
const READY_URL = `http://127.0.0.1:${PORT}/api/auth/me`;

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
  writeFileSync(LOG_PATH, '', 'utf8'); // 清空旧日志（每次运行全新会话）

  const logStream = createWriteStream(LOG_PATH, { flags: 'a' });
  // 直接以 node 启动 next CLI（避免 npx/.cmd 在跨平台与沙箱下的解析差异）
  const nextBin = require.resolve('next/dist/bin/next');
  server = spawn(
    process.execPath,
    [nextBin, 'dev', '-p', String(PORT)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        NEXT_TELEMETRY_DISABLED: '1',
        // 显式移除 DATABASE_URL → PGlite 回退
        DATABASE_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    },
  );
  server.stdout!.pipe(logStream);
  server.stderr!.pipe(logStream);

  process.env.E2E_DEV_LOG = LOG_PATH;
  process.env.E2E_BASE_URL = `http://127.0.0.1:${PORT}`;
  process.env.E2E_SERVER_PID = String(server.pid);

  await waitForServer();
}

export function getServerProcess(): ChildProcess | null {
  return server;
}
