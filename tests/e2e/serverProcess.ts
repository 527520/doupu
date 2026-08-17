import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';

export const E2E_PORT = 3100;

interface SpawnResult {
  status: number | null;
  error?: Error;
}

export interface ProcessRuntime {
  platform: NodeJS.Platform;
  spawnSync(command: string, args: string[]): SpawnResult;
  kill(pid: number, signal: NodeJS.Signals): void;
}

const defaultRuntime: ProcessRuntime = {
  platform: process.platform,
  spawnSync(command, args) {
    return spawnSync(command, args, { stdio: 'ignore' });
  },
  kill(pid, signal) {
    process.kill(pid, signal);
  },
};

function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** 等待 E2E 服务完全释放端口；超时必须失败，避免下一轮误连残留服务。 */
export async function waitForPortClosed(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portIsOpen(port))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`E2E dev server 端口 ${port} 在 ${timeoutMs}ms 后仍在监听`);
}

/**
 * 终止由 globalSetup 启动的完整进程树，并以端口释放作为完成条件。
 * Unix 依赖 spawn(detached=true) 建立独立进程组；Windows 使用 taskkill /T。
 */
export async function stopProcessTree(
  pid: number,
  port: number,
  runtime: ProcessRuntime = defaultRuntime,
  timeoutMs = 10_000,
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`无效的 E2E server pid: ${pid}`);

  if (runtime.platform === 'win32') {
    const result = runtime.spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`taskkill 终止 E2E server 失败（exit ${result.status}）`);
  } else {
    try {
      runtime.kill(-pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }

  try {
    await waitForPortClosed(port, timeoutMs);
  } catch (error) {
    if (runtime.platform === 'win32') throw error; // taskkill /F 已经是强制终止
    try {
      runtime.kill(-pid, 'SIGKILL');
    } catch (killError) {
      if ((killError as NodeJS.ErrnoException).code !== 'ESRCH') throw killError;
    }
    await waitForPortClosed(port, Math.max(timeoutMs, 1_000));
  }
}
