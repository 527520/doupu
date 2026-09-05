// Loopback-only TLS fixture. Never changes application security headers.
import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const [keyFile, certFile] = process.argv.slice(2);
https.createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (request, response) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: 3108, method: request.method, path: request.url, headers: request.headers }, (result) => {
    response.writeHead(result.statusCode ?? 502, result.headers);
    result.pipe(response);
  });
  upstream.on('error', () => { response.writeHead(502); response.end(); });
  request.pipe(upstream);
}).listen(3448, '127.0.0.1', () => console.log('Local TLS fixture on https://127.0.0.1:3448'));
