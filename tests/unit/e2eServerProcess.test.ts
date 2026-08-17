import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  stopProcessTree,
  waitForPortClosed,
  type ProcessRuntime,
} from '../e2e/serverProcess';

const children = new Set<ChildProcess>();

afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
});

async function spawnHttpServer(ignoreSigterm = false): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `${ignoreSigterm ? "process.on('SIGTERM',()=>{});" : ''}const s=require('node:http').createServer((_q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`,
    ],
    {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  children.add(child);
  const port = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.stdout!.once('data', (chunk) => resolve(Number(String(chunk).trim())));
  });
  return { child, port };
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('E2E dev server lifecycle', () => {
  it('stops the whole Unix process group and waits until its port is closed', async () => {
    const { child, port } = await spawnHttpServer();
    expect(await canConnect(port)).toBe(true);

    await stopProcessTree(child.pid!, port);

    expect(await canConnect(port)).toBe(false);
    children.delete(child);
  });

  it('uses taskkill for a Windows process tree and still verifies port release', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runtime: ProcessRuntime = {
      platform: 'win32',
      spawnSync(command, args) {
        calls.push({ command, args });
        return { status: 0, error: undefined };
      },
      kill() {
        throw new Error('Windows must not use POSIX kill');
      },
    };

    await stopProcessTree(42, 65_535, runtime, 100);

    expect(calls).toEqual([{ command: 'taskkill', args: ['/pid', '42', '/T', '/F'] }]);
  });

  it.runIf(process.platform !== 'win32')('escalates to SIGKILL when graceful shutdown cannot release the port', async () => {
    const { child, port } = await spawnHttpServer(true);

    await stopProcessTree(child.pid!, port, undefined, 100);

    expect(await canConnect(port)).toBe(false);
    children.delete(child);
  });

  it('reports a port that remains open instead of silently succeeding', async () => {
    const { child, port } = await spawnHttpServer();

    await expect(waitForPortClosed(port, 50)).rejects.toThrow(/仍在监听/);

    child.kill('SIGKILL');
  });
});
