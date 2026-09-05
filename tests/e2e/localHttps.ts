import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

/** Real loopback TLS for Secure-cookie tests, without changing production cookies
 * or the HTTP application harness. The certificate is test-owned and ephemeral. */
export async function localHttps(upstreamOrigin: string) {
  const target = new URL(upstreamOrigin);
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') throw new Error('Loopback HTTP upstream required');
  const directory = mkdtempSync(join(tmpdir(), 'doupu-e2e-tls-'));
  const key = join(directory, 'key.pem'); const cert = join(directory, 'cert.pem');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore', timeout: 15000 });
    const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
      const upstream = http.request({ hostname: '127.0.0.1', port: target.port, path: request.url, method: request.method,
        headers: { ...request.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': request.headers.host } }, (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers); incoming.pipe(response);
      });
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      response.on('close', () => upstream.destroy()); request.pipe(upstream);
    });
    const sockets = new Set<Duplex>();
    server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    // Next's dev client needs its initial HMR handshake before hydration.
    server.on('upgrade', (request, socket, head) => {
      const upstream = http.request({ hostname: '127.0.0.1', port: target.port, path: request.url, headers: request.headers });
      upstream.on('upgrade', (response, remote, initial) => {
        sockets.add(remote); remote.on('close', () => sockets.delete(remote));
        socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n${Object.entries(response.headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
        if (head.length) remote.write(head); if (initial.length) socket.write(initial);
        remote.pipe(socket); socket.pipe(remote);
        remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
        socket.on('close', () => remote.destroy());
      });
      upstream.on('error', () => socket.destroy()); upstream.end();
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
    return { origin: `https://127.0.0.1:${(server.address() as AddressInfo).port}`, close: async () => {
      sockets.forEach((socket) => socket.destroy());
      server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true });
    } };
  } catch (error) { rmSync(directory, { recursive: true }); throw error; }
}
