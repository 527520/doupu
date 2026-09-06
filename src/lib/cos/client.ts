/**
 * 腾讯云 COS XML API 最小客户端（PUT / GET / HEAD / DELETE 单对象）。
 *
 * 只依赖 fetch 与 node:crypto：签名算法按官方「请求签名」文档实现
 * （q-sign-algorithm=sha1，KeyTime → SignKey → HttpString → StringToSign → Signature），
 * 不引入官方 SDK，避免为一个私有桶带进一整套依赖树。
 * SecretKey 只参与本地 HMAC 派生，不随请求发送；错误只上抛状态码与 COS 错误码。
 */
import { createHash, createHmac } from 'node:crypto';

export interface CosConfig {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  /** 测试注入；默认全局 fetch。 */
  fetcher?: typeof fetch;
  now?: () => Date;
  /** 签名有效期（秒）。 */
  signatureTtlSeconds?: number;
}

export interface CosObject {
  body: Buffer;
  contentType: string | null;
  contentLength: number;
}

export class CosError extends Error {
  constructor(readonly status: number, readonly cosCode: string | null, readonly operation: string) {
    super(`COS ${operation} failed with status ${status}${cosCode ? ` (${cosCode})` : ''}`);
    this.name = 'CosError';
  }
}

function sha1Hex(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex');
}

function hmacSha1Hex(key: string, value: string): string {
  return createHmac('sha1', key).update(value, 'utf8').digest('hex');
}

/** COS 要求 RFC 3986 风格的编码，且键名小写、按字典序排列。 */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface SignatureInput {
  method: string;
  /** 以 / 开头的对象路径，未编码。 */
  path: string;
  headers: Record<string, string>;
  query?: Record<string, string>;
  startTime: number;
  endTime: number;
}

/** 纯函数：生成 Authorization 头（可用官方示例向量单测）。 */
export function buildCosAuthorization(secretId: string, secretKey: string, input: SignatureInput): string {
  const keyTime = `${input.startTime};${input.endTime}`;
  const signKey = hmacSha1Hex(secretKey, keyTime);
  const headerEntries = Object.entries(input.headers).map(([key, value]) => [key.toLowerCase(), value] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const queryEntries = Object.entries(input.query ?? {}).map(([key, value]) => [key.toLowerCase(), value] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const headerList = headerEntries.map(([key]) => key).join(';');
  const paramList = queryEntries.map(([key]) => key).join(';');
  const httpHeaders = headerEntries.map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&');
  const httpParameters = queryEntries.map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&');
  const encodedPath = input.path.split('/').map((segment) => encode(segment)).join('/');
  const httpString = `${input.method.toLowerCase()}\n${encodedPath}\n${httpParameters}\n${httpHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1Hex(httpString)}\n`;
  const signature = hmacSha1Hex(signKey, stringToSign);
  return [
    'q-sign-algorithm=sha1',
    `q-ak=${secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    `q-url-param-list=${paramList}`,
    `q-signature=${signature}`,
  ].join('&');
}

export interface CosClient {
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  getObject(key: string): Promise<CosObject | null>;
  headObject(key: string): Promise<{ contentType: string | null; contentLength: number } | null>;
  deleteObject(key: string): Promise<void>;
  readonly host: string;
}

function parseCosCode(text: string): string | null {
  const match = /<Code>([^<]+)<\/Code>/u.exec(text);
  return match ? match[1] : null;
}

export function createCosClient(config: CosConfig): CosClient {
  const host = `${config.bucket}.cos.${config.region}.myqcloud.com`;
  const fetcher = config.fetcher ?? fetch;
  const ttl = config.signatureTtlSeconds ?? 600;
  const request = async (method: 'PUT' | 'GET' | 'HEAD' | 'DELETE', key: string, body?: Uint8Array, contentType?: string): Promise<Response> => {
    const path = `/${key}`;
    const now = Math.floor((config.now?.() ?? new Date()).getTime() / 1000);
    const headers: Record<string, string> = { host };
    if (body) {
      headers['content-length'] = String(body.byteLength);
      headers['content-type'] = contentType ?? 'application/octet-stream';
    }
    const authorization = buildCosAuthorization(config.secretId, config.secretKey, { method, path, headers, startTime: now - 60, endTime: now + ttl });
    const sendHeaders: Record<string, string> = { authorization };
    if (body) { sendHeaders['content-type'] = headers['content-type']; sendHeaders['content-length'] = headers['content-length']; }
    const encodedPath = path.split('/').map((segment) => encode(segment)).join('/');
    return fetcher(`https://${host}${encodedPath}`, { method, headers: sendHeaders, body: body ? new Uint8Array(body) : undefined, redirect: 'error' });
  };
  return {
    host,
    async putObject(key, body, contentType) {
      const response = await request('PUT', key, body, contentType);
      if (!response.ok) throw new CosError(response.status, parseCosCode(await response.text().catch(() => '')), 'PutObject');
    },
    async getObject(key) {
      const response = await request('GET', key);
      if (response.status === 404) return null;
      if (!response.ok) throw new CosError(response.status, parseCosCode(await response.text().catch(() => '')), 'GetObject');
      const bytes = Buffer.from(await response.arrayBuffer());
      return { body: bytes, contentType: response.headers.get('content-type'), contentLength: bytes.length };
    },
    async headObject(key) {
      const response = await request('HEAD', key);
      if (response.status === 404) return null;
      if (!response.ok) throw new CosError(response.status, null, 'HeadObject');
      return { contentType: response.headers.get('content-type'), contentLength: Number(response.headers.get('content-length') ?? 0) };
    },
    async deleteObject(key) {
      const response = await request('DELETE', key);
      // 已不存在的对象视为删除成功：删除流程要幂等可重试。
      if (response.status === 404 || response.status === 204 || response.ok) return;
      throw new CosError(response.status, parseCosCode(await response.text().catch(() => '')), 'DeleteObject');
    },
  };
}

/**
 * 从环境变量读取原图桶配置；未配置返回 null（由调用方决定是否允许降级）。
 * 默认与备份共用同一个私有桶（原图固定在 `originals/` 前缀下，备份在 `doupu-backup/`），
 * `COS_ORIGINALS_*` 只在需要单独的桶 / 子账号 / 地域时覆盖。
 */
export function resolveOriginalsCosConfig(env: Record<string, string | undefined> = process.env): Omit<CosConfig, 'fetcher' | 'now'> | null {
  const secretId = env.COS_ORIGINALS_SECRET_ID ?? env.COS_SECRET_ID;
  const secretKey = env.COS_ORIGINALS_SECRET_KEY ?? env.COS_SECRET_KEY;
  const bucket = env.COS_ORIGINALS_BUCKET ?? env.COS_BUCKET;
  const region = env.COS_ORIGINALS_REGION ?? env.COS_REGION;
  if (!secretId || !secretKey || !bucket || !region) return null;
  return { secretId, secretKey, bucket, region };
}
