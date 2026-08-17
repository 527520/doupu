/** E2E 全局清理：跨平台结束 dev 服务器进程树，并确认端口已释放。 */
import { E2E_PORT, stopProcessTree } from './serverProcess';

export default async function globalTeardown(): Promise<void> {
  const pid = process.env.E2E_SERVER_PID;
  if (pid) {
    await stopProcessTree(Number(pid), E2E_PORT);
  }
}
