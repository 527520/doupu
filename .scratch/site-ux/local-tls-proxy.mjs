import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';

// 仅回环测试入口；生产不使用此代理或测试证书。
const [key, cert] = process.argv.slice(2);
const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: 3109, path: request.url, method: request.method,
    headers: { ...request.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': request.headers.host },
  }, (incoming) => { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response); });
  upstream.on('error', () => { response.writeHead(502); response.end(); });
  request.pipe(upstream);
});
server.on('upgrade', (request, socket, head) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: 3109, path: request.url, headers: request.headers });
  upstream.on('upgrade', (response, remote, initial) => {
    socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n${Object.entries(response.headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
    if (head.length) remote.write(head);
    if (initial.length) socket.write(initial);
    remote.pipe(socket); socket.pipe(remote);
    remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
  });
  upstream.on('error', () => socket.destroy()); upstream.end();
});
server.listen(3443, '127.0.0.1', () => console.log('Local TLS test proxy ready on 3443'));
