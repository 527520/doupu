/**
 * 浏览器侧随机标识。
 *
 * `crypto.randomUUID` 只在安全上下文（HTTPS / localhost）暴露；通过局域网 IP 以
 * HTTP 访问时它是 `undefined`，直接调用会在状态更新之前抛出 TypeError，表现为
 * 「选了图片却没有任何反应」。`crypto.getRandomValues` 在非安全上下文同样可用，
 * 因此这里按 RFC 4122 v4 手工拼装，保证格式与服务端幂等键约束一致。
 */
export function randomId(): string {
  const webCrypto: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
