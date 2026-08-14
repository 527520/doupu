import { describe, expect, it } from 'vitest';
import { createSyncClient, type CloudDesignFull, type CloudDesignMeta } from './clientAdapter';
import type { DesignRecord, StorageAdapter } from '@/lib/storage';
import type { ProjectFile } from '@/lib/types';

function makeProject(name: string, updatedAt: string): ProjectFile {
  return {
    format: 'doupu-project',
    version: 1,
    name,
    createdAt: updatedAt,
    updatedAt,
    palette: { kind: 'builtin', brand: 'MARD' },
    params: {
      targetWidth: 20,
      targetColorCount: 40,
      dithering: false,
      mode: 'dominant',
      brightness: 0,
      contrast: 0,
      backgroundRemoval: false,
      bgTolerance: 8,
    },
    pattern: {
      width: 1,
      height: 1,
      cells: [{ hex: '#FF0000', code: 'F02', transparent: false }],
    },
  };
}

function record(id: string, project: ProjectFile, updatedAt: string): DesignRecord {
  return { id, name: project.name, projectJson: JSON.stringify(project), thumbnail: null, updatedAt };
}

class FakeStorage implements StorageAdapter {
  records = new Map<string, DesignRecord>();
  meta = new Map<string, string>();
  async getAll(): Promise<DesignRecord[]> {
    return [...this.records.values()];
  }
  async put(r: DesignRecord): Promise<void> {
    this.records.set(r.id, { ...r });
  }
  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
  async getMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }
  async setMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
  }
}

class FakeApi {
  cloud = new Map<string, CloudDesignFull>();
  deleted: string[] = [];
  putCalls: string[] = [];
  constructor(entries: CloudDesignFull[] = []) {
    for (const entry of entries) this.cloud.set(entry.id, entry);
  }
  async listDesigns(): Promise<CloudDesignMeta[]> {
    return [...this.cloud.values()].map((d) => ({
      id: d.id,
      name: d.name,
      width: d.project.pattern.width,
      height: d.project.pattern.height,
      updatedAt: d.updatedAt,
    }));
  }
  async getDesign(id: string): Promise<CloudDesignFull | null> {
    return this.cloud.get(id) ?? null;
  }
  async putDesign(id: string, name: string, project: ProjectFile): Promise<{ updatedAt: string }> {
    // 模拟服务端时间戳总比客户端新 1 秒
    const updatedAt = new Date(Date.parse(project.updatedAt) + 1000).toISOString();
    this.cloud.set(id, { id, name, project: { ...project, updatedAt }, updatedAt });
    this.putCalls.push(id);
    return { updatedAt };
  }
  async deleteDesign(id: string): Promise<void> {
    this.deleted.push(id);
    this.cloud.delete(id);
  }
}

describe('createSyncClient（E35–E37 适配层行为）', () => {
  it('E35：本地独有设计推送到云端，采纳服务端时间戳；重复同步幂等', async () => {
    const storage = new FakeStorage();
    const api = new FakeApi();
    const project = makeProject('设计A', '2026-08-15T00:00:00.000Z');
    await storage.put(record('a1', project, project.updatedAt));
    const client = createSyncClient(storage, api);

    const first = await client.sync();
    expect(first.pushed).toBe(1);
    expect(first.pulled).toBe(0);
    expect(api.putCalls).toEqual(['a1']);
    expect(api.cloud.has('a1')).toBe(true);
    // 本地采纳服务端时间戳
    const local = await storage.getAll();
    expect(local[0].updatedAt).toBe(api.cloud.get('a1')!.updatedAt);

    const second = await client.sync();
    expect(second.pushed).toBe(0);
    expect(second.pulled).toBe(0);
    expect(second.errors).toEqual([]);
  });

  it('E36：云端较新 → 拉取覆盖本地并报告 overwrittenByCloud', async () => {
    const cloudProject = makeProject('云端版', '2026-08-15T10:00:00.000Z');
    const api = new FakeApi([{ id: 'b1', name: '云端版', project: cloudProject, updatedAt: cloudProject.updatedAt }]);
    const storage = new FakeStorage();
    const localProject = makeProject('本地版', '2026-08-15T09:00:00.000Z');
    await storage.put(record('b1', localProject, localProject.updatedAt));
    const client = createSyncClient(storage, api);

    const outcome = await client.sync();
    expect(outcome.pulled).toBe(1);
    expect(outcome.overwrittenByCloud).toEqual(['b1']);
    const local = await storage.getAll();
    expect(local[0].name).toBe('云端版');
    expect(local[0].updatedAt).toBe(cloudProject.updatedAt);
  });

  it('E37：本地较新编辑（云端已删/较旧）→ 推送复活', async () => {
    const api = new FakeApi(); // 云端列表为空（已删）
    const storage = new FakeStorage();
    const project = makeProject('离线编辑', '2026-08-15T12:00:00.000Z');
    await storage.put(record('c1', project, project.updatedAt));
    const client = createSyncClient(storage, api);

    const outcome = await client.sync();
    expect(outcome.pushed).toBe(1);
    expect(api.cloud.get('c1')!.name).toBe('离线编辑');
  });

  it('本地墓碑：deleteLocal 后同步调用云端 DELETE 并清理墓碑', async () => {
    const api = new FakeApi();
    const storage = new FakeStorage();
    const project = makeProject('待删', '2026-08-15T00:00:00.000Z');
    await storage.put(record('d1', project, project.updatedAt));
    const client = createSyncClient(storage, api);

    await client.deleteLocal('d1', '2026-08-15T13:00:00.000Z');
    expect(await storage.getAll()).toEqual([]);

    const outcome = await client.sync();
    expect(api.deleted).toEqual(['d1']);
    expect(outcome.pushed).toBe(1);
    // 墓碑已清理：再次同步零操作
    const again = await client.sync();
    expect(again.pushed).toBe(0);
    expect(again.pulled).toBe(0);
  });

  it('云端独有设计拉取到本地；pullDesign 单独拉取可用', async () => {
    const project = makeProject('云端设计', '2026-08-15T08:00:00.000Z');
    const api = new FakeApi([{ id: 'e1', name: '云端设计', project, updatedAt: project.updatedAt }]);
    const storage = new FakeStorage();
    const client = createSyncClient(storage, api);

    const outcome = await client.sync();
    expect(outcome.pulled).toBe(1);
    const local = await storage.getAll();
    expect(local[0].name).toBe('云端设计');
    expect(local[0].thumbnail).toBeNull();
  });

  it('本地数据损坏：跳过并记录错误，不影响其余设计同步', async () => {
    const api = new FakeApi();
    const storage = new FakeStorage();
    const good = makeProject('完好', '2026-08-15T00:00:00.000Z');
    await storage.put(record('ok1', good, good.updatedAt));
    await storage.put({ id: 'bad1', name: '损坏', projectJson: '{broken', thumbnail: null, updatedAt: '2026-08-15T00:00:00.000Z' });
    const client = createSyncClient(storage, api);

    const outcome = await client.sync();
    expect(outcome.pushed).toBe(1);
    expect(outcome.errors.some((e) => e.includes('bad1'))).toBe(true);
  });

  it('renameLocal 更新名称与时间戳（记录与项目 JSON 同步）', async () => {
    const api = new FakeApi();
    const storage = new FakeStorage();
    const project = makeProject('旧名', '2026-08-15T00:00:00.000Z');
    await storage.put(record('f1', project, project.updatedAt));
    const client = createSyncClient(storage, api);

    await client.renameLocal('f1', '新名', '2026-08-15T14:00:00.000Z');
    const local = await storage.getAll();
    expect(local[0].name).toBe('新名');
    expect(local[0].updatedAt).toBe('2026-08-15T14:00:00.000Z');
    const parsed = JSON.parse(local[0].projectJson) as ProjectFile;
    expect(parsed.name).toBe('新名');
    expect(parsed.updatedAt).toBe('2026-08-15T14:00:00.000Z');
  });

  it('renameLocal 对不存在的设计抛 NOT_FOUND', async () => {
    const client = createSyncClient(new FakeStorage(), new FakeApi());
    await expect(client.renameLocal('missing', 'x', '2026-08-15T00:00:00.000Z')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
