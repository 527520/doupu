import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cosClient from '@/lib/cos/client';
import {
  createCosOriginalStore,
  createFileOriginalStore,
  createMemoryOriginalStore,
  getOriginalStore,
  setOriginalStore,
} from './originalStore';

describe('originalStore', () => {
  afterEach(() => {
    setOriginalStore(null);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('内存实现 put/get/delete 语义与缺失键一致', async () => {
    const store = createMemoryOriginalStore();
    await store.put('a/b', new Uint8Array([1, 2]), 'image/png');
    expect(await store.get('a/b')).toEqual({ body: Buffer.from([1, 2]), contentType: 'image/png' });
    expect(await store.get('missing')).toBeNull();
    await store.delete('a/b');
    expect(await store.get('a/b')).toBeNull();
  });

  it('文件实现写入后可读，缺失返回 null，越界键拒绝', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupu-originals-'));
    try {
      const store = createFileOriginalStore(root);
      await store.put('nested/key', new Uint8Array([9, 8, 7]), 'image/webp');
      expect(await store.get('nested/key')).toEqual({
        body: Buffer.from([9, 8, 7]),
        contentType: 'image/webp',
      });
      expect(await store.get('nope')).toBeNull();
      await store.delete('nested/key');
      expect(await store.get('nested/key')).toBeNull();
      await expect(store.put('../escape', new Uint8Array([1]), 'image/png')).rejects.toThrow('原图对象键越界');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('setOriginalStore 注入后 getOriginalStore 返回同一实例', () => {
    const store = createMemoryOriginalStore();
    setOriginalStore(store);
    expect(getOriginalStore()).toBe(store);
  });

  it('COS 实现把缺失对象映成 null，put/delete 转给客户端', async () => {
    const client = {
      putObject: vi.fn(async () => undefined),
      getObject: vi.fn(async () => null),
      deleteObject: vi.fn(async () => undefined),
    };
    vi.spyOn(cosClient, 'createCosClient').mockReturnValue(client as unknown as ReturnType<typeof cosClient.createCosClient>);
    const store = createCosOriginalStore({
      secretId: 'id',
      secretKey: 'key',
      bucket: 'bucket',
      region: 'ap-guangzhou',
    });
    expect(store.kind).toBe('cos');
    expect(await store.get('k')).toBeNull();
    await store.put('k', new Uint8Array([1]), 'image/png');
    await store.delete('k');
    expect(client.putObject).toHaveBeenCalledOnce();
    expect(client.deleteObject).toHaveBeenCalledOnce();
  });

  it('文件读取遇到非缺失错误继续抛出', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupu-originals-'));
    try {
      const store = createFileOriginalStore(root);
      await mkdir(join(root, 'isdir'));
      await expect(store.get('isdir')).rejects.toMatchObject({ code: 'EISDIR' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('无 COS 配置时开发态落到文件存储；生产环境则拒绝启动', () => {
    vi.spyOn(cosClient, 'resolveOriginalsCosConfig').mockReturnValue(null);
    expect(getOriginalStore().kind).toBe('file');
    setOriginalStore(null);
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getOriginalStore()).toThrow(/COS bucket/);
  });

  it('有 COS 配置时 getOriginalStore 走 COS 实现', () => {
    const client = {
      putObject: vi.fn(async () => undefined),
      getObject: vi.fn(async () => ({ body: Buffer.from([1]), contentType: 'image/png' })),
      deleteObject: vi.fn(async () => undefined),
    };
    vi.spyOn(cosClient, 'resolveOriginalsCosConfig').mockReturnValue({
      secretId: 'id',
      secretKey: 'key',
      bucket: 'bucket',
      region: 'ap-guangzhou',
    });
    vi.spyOn(cosClient, 'createCosClient').mockReturnValue(client as unknown as ReturnType<typeof cosClient.createCosClient>);
    const store = getOriginalStore();
    expect(store.kind).toBe('cos');
  });
});
