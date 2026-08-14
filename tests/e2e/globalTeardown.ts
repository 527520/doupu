/** E2E 全局清理：结束 dev 服务器。 */
import { spawnSync } from 'node:child_process';

export default async function globalTeardown(): Promise<void> {
  const pid = process.env.E2E_SERVER_PID;
  if (pid) {
    // Windows 下结束进程树
    spawnSync('taskkill', ['/pid', pid, '/T', '/F'], { stdio: 'ignore' });
  }
}
