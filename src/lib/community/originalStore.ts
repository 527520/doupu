/**
 * 作品原图对象存储（D49）。
 * 生产使用私有 COS 桶；开发 / E2E 没有 COS 凭证时落到本机目录，
 * 语义（put/get/delete、404 → null、删除幂等）与 COS 客户端保持一致。
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createCosClient, resolveOriginalsCosConfig } from '@/lib/cos/client';

export interface StoredObject { body: Buffer; contentType: string | null }

export interface OriginalObjectStore {
  readonly kind: 'cos' | 'file' | 'memory';
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export function createMemoryOriginalStore(): OriginalObjectStore & { objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  return {
    kind: 'memory',
    objects,
    async put(key, body, contentType) { objects.set(key, { body: Buffer.from(body), contentType }); },
    async get(key) { return objects.get(key) ?? null; },
    async delete(key) { objects.delete(key); },
  };
}

function safeKeyPath(root: string, key: string): string {
  const target = resolve(root, key);
  if (!target.startsWith(resolve(root))) throw new Error('原图对象键越界');
  return target;
}

export function createFileOriginalStore(root: string): OriginalObjectStore {
  return {
    kind: 'file',
    async put(key, body, contentType) {
      const path = safeKeyPath(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      await writeFile(`${path}.type`, contentType, 'utf8');
    },
    async get(key) {
      const path = safeKeyPath(root, key);
      try {
        const [body, contentType] = await Promise.all([readFile(path), readFile(`${path}.type`, 'utf8').catch(() => null)]);
        return { body, contentType };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      const path = safeKeyPath(root, key);
      await rm(path, { force: true });
      await rm(`${path}.type`, { force: true });
    },
  };
}

export function createCosOriginalStore(config: NonNullable<ReturnType<typeof resolveOriginalsCosConfig>>): OriginalObjectStore {
  const client = createCosClient(config);
  return {
    kind: 'cos',
    put: (key, body, contentType) => client.putObject(key, body, contentType),
    async get(key) {
      const object = await client.getObject(key);
      return object ? { body: object.body, contentType: object.contentType } : null;
    },
    delete: (key) => client.deleteObject(key),
  };
}

let singleton: OriginalObjectStore | null = null;

/** 进程内单例；测试可通过 setOriginalStore 注入内存实现。 */
export function getOriginalStore(): OriginalObjectStore {
  if (singleton) return singleton;
  const config = resolveOriginalsCosConfig();
  if (config) singleton = createCosOriginalStore(config);
  else if (process.env.NODE_ENV === 'production') throw new Error('COS bucket for community originals is required in production (COS_BUCKET or COS_ORIGINALS_BUCKET plus credentials/region)');
  else singleton = createFileOriginalStore(process.env.ORIGINALS_LOCAL_DIR ?? join(process.cwd(), '.local-originals'));
  return singleton;
}

export function setOriginalStore(store: OriginalObjectStore | null): void {
  singleton = store;
}
