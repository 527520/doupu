import type { StitchProgress } from '@/lib/progress/stitchProgress';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createSyncClient, type CloudDesignFull, type CloudDesignMeta } from './clientAdapter';
import type {
  DesignRecord,
  GenerationSourceWrite,
  LocalGenerationSourceV1,
  StorageAdapter,
} from '@/lib/storage';
import type { ProjectFile } from '@/lib/types';

function makeProject(name: string, updatedAt: string): ProjectFile {
  return {
    format: 'doupu-project',
    version: 3,
    engineVersion: '2.0.0',
    boardProfile: '5mm-29',
    name,
    createdAt: updatedAt,
    updatedAt,
    paletteSelection: {
      palette: { kind: 'builtin', brand: 'MARD' },
      kitTier: 0,
    },
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
      cells: [{ hex: '#FC3D46', code: 'F02', transparent: false }],
    },
  };
}

function record(id: string, project: ProjectFile, updatedAt: string, revision = 0, syncState: DesignRecord['syncState'] = 'dirty'): DesignRecord {
  return { id, name: project.name, projectJson: JSON.stringify(project), thumbnail: null, updatedAt, revision, syncState };
}

class FakeStorage implements StorageAdapter {
  records = new Map<string, DesignRecord>();
  meta = new Map<string, string>();
  sources = new Map<string, LocalGenerationSourceV1>();
  async getAll(): Promise<DesignRecord[]> {
    return [...this.records.values()];
  }
  async put(r: DesignRecord, sourceWrite: GenerationSourceWrite = { mode: 'preserve' }): Promise<void> {
    this.records.set(r.id, { ...r });
    if (sourceWrite.mode === 'replace') this.sources.set(r.id, structuredClone(sourceWrite.source));
    if (sourceWrite.mode === 'clear') this.sources.delete(r.id);
  }
  async delete(id: string): Promise<void> {
    this.records.delete(id);
    this.sources.delete(id);
  }
  async getGenerationSource(id: string): Promise<LocalGenerationSourceV1 | null> {
    const source = this.sources.get(id);
    return source ? structuredClone(source) : null;
  }
  async getMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }
  readonly stitchProgress = new Map<string, StitchProgress>();
  async getStitchProgress(designId: string): Promise<StitchProgress | null> {
    return this.stitchProgress.get(designId) ?? null;
  }
  async putStitchProgress(designId: string, progress: StitchProgress): Promise<void> {
    this.stitchProgress.set(designId, progress);
  }
  async deleteStitchProgress(designId: string): Promise<void> {
    this.stitchProgress.delete(designId);
  }
  async setMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
  }
}

class FakeApi {
  cloud = new Map<string, CloudDesignFull>();
  deleted: string[] = [];
  putCalls: string[] = [];
  putProjects: ProjectFile[] = [];
  constructor(entries: Array<Omit<CloudDesignFull, 'revision'> & { revision?: number }> = []) {
    for (const entry of entries) this.cloud.set(entry.id, { ...entry, revision: entry.revision ?? 1 });
  }
  async listDesignsPage(): Promise<{ items: CloudDesignMeta[]; nextCursor: null }> {
    return { items: [...this.cloud.values()].map((d) => ({
      id: d.id,
      name: d.name,
      width: d.project.pattern.width,
      height: d.project.pattern.height,
      updatedAt: d.updatedAt,
      deleted: d.deleted ?? false,
      revision: d.revision,
    })), nextCursor: null };
  }
  async getDesign(id: string): Promise<CloudDesignFull | null> {
    return this.cloud.get(id) ?? null;
  }
  async putDesign(id: string, name: string, project: ProjectFile, baseRevision: number): Promise<{ updatedAt: string; revision: number }> {
    this.putProjects.push(structuredClone(project));
    const current = this.cloud.get(id);
    if ((current?.revision ?? 0) !== baseRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'conflict');
    // 模拟服务端时间戳总比客户端新 1 秒
    const updatedAt = new Date(Date.parse(project.updatedAt) + 1000).toISOString();
    const revision = baseRevision + 1;
    this.cloud.set(id, { id, name, project: { ...project, updatedAt }, updatedAt, revision, deleted: false });
    this.putCalls.push(id);
    return { updatedAt, revision };
  }
  async deleteDesign(id: string, baseRevision: number): Promise<{ updatedAt: string; revision: number }> {
    const current = this.cloud.get(id);
    if (!current || (current.revision ?? 1) !== baseRevision) throw new Error('conflict');
    this.deleted.push(id);
    this.cloud.delete(id);
    return { updatedAt: new Date().toISOString(), revision: baseRevision + 1 };
  }
}

describe('createSyncClient（E35–E37 适配层行为）', () => {
  it('严格隔离非法本地项目：记录结构化 issue，其他合法 v3 仍完成同步', async () => {
    const storage = new FakeStorage();
    const api = new FakeApi();
    const valid = makeProject('合法 v3', '2026-08-15T00:00:00.000Z');
    await storage.put(record('valid-v3', valid, valid.updatedAt));
    await storage.put({
      ...record('legacy-v2', valid, valid.updatedAt),
      projectJson: JSON.stringify({ ...valid, version: 2 }),
    });

    const outcome = await createSyncClient(storage, api).sync();

    expect(api.putCalls).toEqual(['valid-v3']);
    expect(outcome.syncedIds).toEqual(['valid-v3']);
    expect(outcome.issues).toEqual([
      {
        designId: 'legacy-v2',
        operation: 'validate-local',
        code: 'INVALID_PROJECT_V3',
        message: '本地项目不是严格 ProjectFile v3，已跳过同步',
      },
    ]);
  });

  it('严格隔离非法云端项目：单条拉取失败不阻断其他合法 v3', async () => {
    const storage = new FakeStorage();
    const valid = makeProject('合法云端 v3', '2026-08-15T00:00:00.000Z');
    const invalid = makeProject('损坏云端记录', '2026-08-15T00:00:00.000Z');
    const api = new FakeApi([
      { id: 'bad-cloud', name: invalid.name, project: invalid, updatedAt: invalid.updatedAt },
      { id: 'good-cloud', name: valid.name, project: valid, updatedAt: valid.updatedAt },
    ]);
    const originalGet = api.getDesign.bind(api);
    api.getDesign = async (id) => {
      if (id === 'bad-cloud') throw new ApiError(502, 'INVALID_RESPONSE', '云端返回了不兼容的数据');
      return originalGet(id);
    };

    const outcome = await createSyncClient(storage, api).sync();

    expect((await storage.getAll()).map((item) => item.id)).toEqual(['good-cloud']);
    expect(outcome.syncedIds).toEqual(['good-cloud']);
    expect(outcome.issues).toEqual([
      {
        designId: 'bad-cloud',
        operation: 'pull',
        code: 'INVALID_RESPONSE',
        message: '云端返回了不兼容的数据',
      },
    ]);
  });

  it('成功 push 只上传 ProjectFile 并保留本地生成源', async () => {
    const storage = new FakeStorage();
    const api = new FakeApi();
    const project = makeProject('含本地源的设计', '2026-08-15T00:00:00.000Z');
    const source: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([255, 0, 0, 255]).buffer,
    };
    await storage.put(record('source-push', project, project.updatedAt), { mode: 'replace', source });

    const outcome = await createSyncClient(storage, api).sync();

    expect(outcome.pushed).toBe(1);
    expect(await storage.getGenerationSource('source-push')).toEqual(source);
    expect(api.putProjects).toHaveLength(1);
    expect(api.putProjects[0]).not.toHaveProperty('source');
    expect(JSON.parse(storage.records.get('source-push')!.projectJson)).not.toHaveProperty('source');
  });

  it('冲突副本即使已创建云端 revision，显式解决前也不得进入 syncedIds', async () => {
    const storage = new FakeStorage();
    const api = new FakeApi();
    const project = makeProject('未解决冲突副本', '2026-08-15T00:00:00.000Z');
    await storage.put(record('conflict-copy', project, project.updatedAt, 0, 'conflict'));

    const first = await createSyncClient(storage, api).sync();
    const second = await createSyncClient(storage, api).sync();

    expect(storage.records.get('conflict-copy')).toMatchObject({ revision: 1, syncState: 'conflict' });
    expect(first.syncedIds).not.toContain('conflict-copy');
    expect(second.syncedIds).not.toContain('conflict-copy');
  });

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

  it('并发创建返回 409 但内容相同时，结果必须立即包含已确认的云端 revision', async () => {
    const project = makeProject('同一设计', '2026-08-15T00:00:00.000Z');
    const normalizedRemote: ProjectFile = {
      ...project,
      pattern: {
        ...project.pattern,
        cells: project.pattern.cells.map((cell) => ({
          ...cell,
          hex: cell.hex?.toLowerCase() ?? null,
          external: false,
        })),
      },
    };
    const api = new FakeApi([{ id: 'same-1', name: project.name, project: normalizedRemote, updatedAt: project.updatedAt, revision: 1 }]);
    api.listDesignsPage = async () => ({ items: [], nextCursor: null });
    const storage = new FakeStorage();
    const source: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([10, 20, 30, 255]).buffer,
    };
    const sameRecord = record('same-1', project, project.updatedAt, 0, 'dirty');
    sameRecord.thumbnail = 'data:image/png;base64,profile-aware-409';
    await storage.put(sameRecord, { mode: 'replace', source });

    const outcome = await createSyncClient(storage, api).sync();

    expect(outcome.conflictCopies).toEqual([]);
    expect(outcome.cloud).toEqual([expect.objectContaining({ id: 'same-1', revision: 1, deleted: false })]);
    expect(await storage.getAll()).toEqual([expect.objectContaining({ id: 'same-1', revision: 1, syncState: 'synced' })]);
    expect(await storage.getGenerationSource('same-1')).toEqual(source);
    expect(storage.records.get('same-1')?.thumbnail).toBe('data:image/png;base64,profile-aware-409');
  });

  it('手动背景原型不同必须创建冲突副本，不能被内容等价判断静默覆盖', async () => {
    const remoteProject = makeProject('背景设计', '2026-08-15T00:00:00.000Z');
    remoteProject.params.backgroundPrototype = '#FFFFFF';
    const localProject = structuredClone(remoteProject);
    localProject.params.backgroundPrototype = '#000000';
    const api = new FakeApi([{ id: 'background-1', name: remoteProject.name, project: remoteProject, updatedAt: remoteProject.updatedAt, revision: 1 }]);
    api.listDesignsPage = async () => ({ items: [], nextCursor: null });
    const storage = new FakeStorage();
    await storage.put(record('background-1', localProject, localProject.updatedAt, 0, 'dirty'));

    const outcome = await createSyncClient(storage, api, { newId: () => 'background-conflict' }).sync();

    expect(outcome.conflictCopies).toEqual([{ originalId: 'background-1', conflictId: 'background-conflict' }]);
    expect((await storage.getAll()).find((item) => item.id === 'background-conflict')).toBeTruthy();
  });

  it('制作规格不同必须创建冲突副本，不能被 canonical 比较忽略', async () => {
    const remoteProject = makeProject('同一图纸', '2026-08-15T00:00:00.000Z');
    remoteProject.paletteSelection.palette = { kind: 'custom', colors: [{ code: 'A', hex: '#FF0000' }] };
    remoteProject.pattern.cells[0] = { code: 'A', hex: '#FF0000', transparent: false };
    const localProject = structuredClone(remoteProject);
    localProject.boardProfile = '2.6mm-50';
    const api = new FakeApi([{ id: 'profile-1', name: remoteProject.name, project: remoteProject, updatedAt: remoteProject.updatedAt, revision: 1 }]);
    api.listDesignsPage = async () => ({ items: [], nextCursor: null });
    const storage = new FakeStorage();
    await storage.put(record('profile-1', localProject, localProject.updatedAt, 0, 'dirty'));

    const outcome = await createSyncClient(storage, api, { newId: () => 'profile-conflict' }).sync();

    expect(outcome.conflictCopies).toEqual([{ originalId: 'profile-1', conflictId: 'profile-conflict' }]);
    expect((await storage.getAll()).find((item) => item.id === 'profile-conflict')).toBeTruthy();
  });

  it('套装档位不同必须创建冲突副本，不能被 canonical 比较忽略', async () => {
    const remoteProject = makeProject('同一图纸', '2026-08-15T00:00:00.000Z');
    remoteProject.pattern.cells[0] = { code: 'H07', hex: '#000000', transparent: false };
    const localProject = structuredClone(remoteProject);
    localProject.paletteSelection.kitTier = 24;
    const api = new FakeApi([{ id: 'kit-1', name: remoteProject.name, project: remoteProject, updatedAt: remoteProject.updatedAt, revision: 1 }]);
    api.listDesignsPage = async () => ({ items: [], nextCursor: null });
    const storage = new FakeStorage();
    await storage.put(record('kit-1', localProject, localProject.updatedAt, 0, 'dirty'));

    const outcome = await createSyncClient(storage, api, { newId: () => 'kit-conflict' }).sync();

    expect(outcome.conflictCopies).toEqual([{ originalId: 'kit-1', conflictId: 'kit-conflict' }]);
    const conflict = storage.records.get('kit-conflict');
    expect(conflict).toBeTruthy();
    expect((JSON.parse(conflict!.projectJson) as ProjectFile).paletteSelection.kitTier).toBe(24);
  });

  it('CAS 冲突副本接管本地生成源，原 ID 切换到远端内容后清源', async () => {
    const remoteProject = makeProject('另一设备', '2026-08-15T00:00:03.000Z');
    const localProject = makeProject('本地编辑', '2026-08-15T00:00:02.000Z');
    const api = new FakeApi([{ id: 'source-conflict', name: remoteProject.name, project: remoteProject, updatedAt: remoteProject.updatedAt, revision: 2 }]);
    const storage = new FakeStorage();
    const source: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([80, 90, 100, 255]).buffer,
    };
    await storage.put(record('source-conflict', localProject, localProject.updatedAt, 1, 'dirty'), { mode: 'replace', source });

    const outcome = await createSyncClient(storage, api, { newId: () => 'source-conflict-copy' }).sync();

    expect(outcome.conflictCopies).toEqual([{ originalId: 'source-conflict', conflictId: 'source-conflict-copy' }]);
    expect(await storage.getGenerationSource('source-conflict-copy')).toEqual(source);
    expect(await storage.getGenerationSource('source-conflict')).toBeNull();
    expect(storage.records.get('source-conflict')?.name).toBe('另一设备');
  });

  it('普通 409 业务冲突不能被误当作 revision 冲突', async () => {
    const api = new FakeApi();
    api.putDesign = async () => {
      throw new ApiError(409, 'CONFLICT', '用户存储配额已满');
    };
    const storage = new FakeStorage();
    const project = makeProject('超额设计', '2026-08-15T00:00:00.000Z');
    await storage.put(record('quota-1', project, project.updatedAt, 0, 'dirty'));

    const outcome = await createSyncClient(storage, api, { newId: () => 'must-not-exist' }).sync();

    expect(outcome.conflictCopies).toEqual([]);
    expect(outcome.errors).toEqual(['quota-1: 用户存储配额已满']);
    expect((await storage.getAll()).map((item) => item.id)).toEqual(['quota-1']);
  });

  it('E36：云端较新 → 拉取覆盖本地并报告 overwrittenByCloud', async () => {
    const cloudProject = makeProject('云端版', '2026-08-15T10:00:00.000Z');
    const api = new FakeApi([{ id: 'b1', name: '云端版', project: cloudProject, updatedAt: cloudProject.updatedAt, revision: 2 }]);
    const storage = new FakeStorage();
    const localProject = makeProject('本地版', '2026-08-15T09:00:00.000Z');
    await storage.put(record('b1', localProject, localProject.updatedAt, 1, 'synced'));
    const client = createSyncClient(storage, api);

    const outcome = await client.sync();
    expect(outcome.pulled).toBe(1);
    expect(outcome.overwrittenByCloud).toEqual(['b1']);
    const local = await storage.getAll();
    expect(local[0].name).toBe('云端版');
    expect(local[0].updatedAt).toBe(cloudProject.updatedAt);
  });

  it('远端不同内容覆盖原 ID 时清除仅属于旧内容的本地生成源', async () => {
    const cloudProject = makeProject('云端新版', '2026-08-15T10:00:00.000Z');
    cloudProject.pattern.cells[0] = { hex: '#FAF4C8', code: 'A01', transparent: false };
    const api = new FakeApi([{ id: 'source-overwrite', name: cloudProject.name, project: cloudProject, updatedAt: cloudProject.updatedAt, revision: 2 }]);
    const storage = new FakeStorage();
    const localProject = makeProject('本地旧版', '2026-08-15T09:00:00.000Z');
    const source: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([0, 255, 0, 255]).buffer,
    };
    await storage.put(record('source-overwrite', localProject, localProject.updatedAt, 1, 'synced'), { mode: 'replace', source });

    await createSyncClient(storage, api).sync();

    expect(storage.records.get('source-overwrite')?.name).toBe('云端新版');
    expect(await storage.getGenerationSource('source-overwrite')).toBeNull();
  });

  it('远端 revision 前移但项目内容相同时保留本地生成源', async () => {
    const localProject = makeProject('同内容设计', '2026-08-15T09:00:00.000Z');
    const remoteProject = { ...structuredClone(localProject), updatedAt: '2026-08-15T10:00:00.000Z' };
    const api = new FakeApi([{ id: 'source-same-pull', name: remoteProject.name, project: remoteProject, updatedAt: remoteProject.updatedAt, revision: 2 }]);
    const storage = new FakeStorage();
    const source: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([4, 5, 6, 255]).buffer,
    };
    const localRecord = record('source-same-pull', localProject, localProject.updatedAt, 1, 'synced');
    localRecord.thumbnail = 'data:image/png;base64,profile-aware-pull';
    await storage.put(localRecord, { mode: 'replace', source });

    const outcome = await createSyncClient(storage, api).sync();

    expect(outcome.pulled).toBe(1);
    expect(storage.records.get('source-same-pull')?.revision).toBe(2);
    expect(await storage.getGenerationSource('source-same-pull')).toEqual(source);
    expect(storage.records.get('source-same-pull')?.thumbnail).toBe('data:image/png;base64,profile-aware-pull');
  });

  it('远端只重命名时保留本地生成源与按制作规格生成的缩略图', async () => {
    const localProject = makeProject('本机名称', '2026-08-15T09:00:00.000Z');
    const remoteProject = {
      ...structuredClone(localProject),
      name: '另一设备重命名',
      updatedAt: '2026-08-15T10:00:00.000Z',
    };
    const api = new FakeApi([{
      id: 'rename-same-source',
      name: remoteProject.name,
      project: remoteProject,
      updatedAt: remoteProject.updatedAt,
      revision: 2,
    }]);
    const storage = new FakeStorage();
    const source: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([4, 5, 6, 255]).buffer,
    };
    const localRecord = record('rename-same-source', localProject, localProject.updatedAt, 1, 'synced');
    localRecord.thumbnail = 'data:image/png;base64,board-profile-thumbnail';
    await storage.put(localRecord, { mode: 'replace', source });

    const outcome = await createSyncClient(storage, api).sync();

    expect(outcome.pulled).toBe(1);
    expect(storage.records.get('rename-same-source')).toMatchObject({
      name: '另一设备重命名',
      revision: 2,
      thumbnail: 'data:image/png;base64,board-profile-thumbnail',
    });
    expect(await storage.getGenerationSource('rename-same-source')).toEqual(source);
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

  it('revision CAS 不依赖客户端时钟：落后时钟的脏编辑仍按 baseRevision 提交', async () => {
    // 上次同步基准 10:00；期间另一设备推送到 12:00（服务器 max）；本机时钟落后，编辑记作 11:00
    const cloudProject = makeProject('云端编辑', '2026-08-15T12:00:00.000Z');
    const api = new FakeApi([{ id: 'g1', name: '云端编辑', project: cloudProject, updatedAt: cloudProject.updatedAt, revision: 1 }]);
    const storage = new FakeStorage();
    await storage.setMeta('sync-last-server-time', '2026-08-15T10:00:00.000Z');
    const localProject = makeProject('本地编辑', '2026-08-15T11:00:00.000Z');
    await storage.put(record('g1', localProject, localProject.updatedAt, 1, 'dirty'));
    const client = createSyncClient(storage, api);

    const outcome = await client.sync();
    // 客户端时间不参与胜负；CAS 只认 baseRevision。
    expect(outcome.pushed).toBe(1);
    expect(outcome.pulled).toBe(0);
    expect(outcome.overwrittenByCloud).toEqual([]);
    expect(api.cloud.get('g1')!.name).toBe('本地编辑');
    expect(api.cloud.get('g1')!.updatedAt).toBe('2026-08-15T11:00:01.000Z');

    // 本地采纳服务端时间戳，下一轮同步幂等
    const local = await storage.getAll();
    expect(local[0].updatedAt).toBe('2026-08-15T11:00:01.000Z');
    const again = await client.sync();
    expect(again.pushed).toBe(0);
    expect(again.pulled).toBe(0);
  });

  it('同步 PUT 在途发生的新本地编辑不会被旧快照回写覆盖', async () => {
    const api = new FakeApi();
    let release!: () => void;
    api.putDesign = async (id, name, project, baseRevision) => new Promise((resolve) => {
      release = () => {
        const revision = baseRevision + 1;
        const updatedAt = '2026-08-15T00:00:01.000Z';
        api.cloud.set(id, { id, name, project: { ...project, updatedAt }, updatedAt, revision, deleted: false });
        resolve({ updatedAt, revision });
      };
    });
    const storage = new FakeStorage();
    const original = makeProject('第一次保存', '2026-08-15T00:00:00.000Z');
    const originalSource: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([1, 1, 1, 255]).buffer,
    };
    await storage.put(record('racing', original, original.updatedAt, 0, 'dirty'), { mode: 'replace', source: originalSource });

    const syncing = createSyncClient(storage, api).sync();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const newer = makeProject('同步期间的新编辑', '2026-08-15T00:00:02.000Z');
    const newerSource: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([2, 2, 2, 255]).buffer,
    };
    await storage.put(record('racing', newer, newer.updatedAt, 0, 'dirty'), { mode: 'replace', source: newerSource });
    release();
    const outcome = await syncing;

    const [local] = await storage.getAll();
    expect(local.name).toBe('同步期间的新编辑');
    expect(local.revision).toBe(1);
    expect(local.syncState).toBe('dirty');
    expect(await storage.getGenerationSource('racing')).toEqual(newerSource);
    expect(outcome.syncedIds).not.toContain('racing');
  });

  it('同步 PUT 在途删除本地设计时转为墓碑，不得误报已同步', async () => {
    const api = new FakeApi();
    let release!: () => void;
    api.putDesign = async (id, name, project, baseRevision) => new Promise((resolve) => {
      release = () => {
        const revision = baseRevision + 1;
        const updatedAt = '2026-08-15T00:00:01.000Z';
        api.cloud.set(id, { id, name, project: { ...project, updatedAt }, updatedAt, revision, deleted: false });
        resolve({ updatedAt, revision });
      };
    });
    const storage = new FakeStorage();
    const project = makeProject('即将删除', '2026-08-15T00:00:00.000Z');
    await storage.put(record('delete-racing', project, project.updatedAt, 0, 'dirty'));

    const syncing = createSyncClient(storage, api).sync();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await storage.delete('delete-racing');
    release();
    const outcome = await syncing;

    expect(await storage.getAll()).toEqual([]);
    expect(outcome.syncedIds).not.toContain('delete-racing');
    expect(JSON.parse(storage.meta.get('sync-tombstones-v2') ?? '[]')).toEqual([
      { id: 'delete-racing', baseRevision: 1 },
    ]);
  });

  it('409 后读取冲突详情失败只记录该设计，后续合法设计仍会上传', async () => {
    const remoteProject = makeProject('云端冲突', '2026-08-15T00:00:03.000Z');
    const api = new FakeApi([{ id: 'broken-conflict', name: remoteProject.name, project: remoteProject, updatedAt: remoteProject.updatedAt, revision: 1 }]);
    const originalGet = api.getDesign.bind(api);
    api.getDesign = async (id) => {
      if (id === 'broken-conflict') throw new ApiError(503, 'CLOUD_READ_FAILED', '无法读取冲突详情');
      return originalGet(id);
    };
    const storage = new FakeStorage();
    const conflicting = makeProject('本地冲突', '2026-08-15T00:00:00.000Z');
    const sibling = makeProject('合法后续设计', '2026-08-15T00:00:01.000Z');
    await storage.put(record('broken-conflict', conflicting, conflicting.updatedAt, 0, 'dirty'));
    await storage.put(record('good-sibling', sibling, sibling.updatedAt, 0, 'dirty'));

    const outcome = await createSyncClient(storage, api).sync();

    expect(api.putCalls).toContain('good-sibling');
    expect(outcome.syncedIds).toEqual(['good-sibling']);
    expect(outcome.issues).toContainEqual({
      designId: 'broken-conflict',
      operation: 'push',
      code: 'CLOUD_READ_FAILED',
      message: '无法读取冲突详情',
    });
  });

  it('同步 GET 在途发生的新本地编辑会进入冲突副本，不能被云端回写覆盖', async () => {
    const remoteProject = makeProject('云端新版', '2026-08-15T00:00:03.000Z');
    const api = new FakeApi([{ id: 'pull-race', name: remoteProject.name, project: remoteProject, updatedAt: remoteProject.updatedAt, revision: 2 }]);
    let releaseGet!: () => void;
    api.getDesign = async (id) => new Promise((resolve) => {
      releaseGet = () => resolve(api.cloud.get(id) ?? null);
    });
    const storage = new FakeStorage();
    const original = makeProject('同步基线', '2026-08-15T00:00:00.000Z');
    await storage.put(record('pull-race', original, original.updatedAt, 1, 'synced'));

    const syncing = createSyncClient(storage, api, { newId: () => 'pull-race-conflict' }).sync();
    await vi.waitFor(() => expect(releaseGet).toBeTypeOf('function'));
    const newer = makeProject('GET 期间的新编辑', '2026-08-15T00:00:04.000Z');
    const newerSource: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([3, 3, 3, 255]).buffer,
    };
    await storage.put(record('pull-race', newer, newer.updatedAt, 1, 'dirty'), { mode: 'replace', source: newerSource });
    releaseGet();
    const outcome = await syncing;

    expect(outcome.conflictCopies).toEqual([{ originalId: 'pull-race', conflictId: 'pull-race-conflict' }]);
    expect((await storage.getAll()).find((item) => item.id === 'pull-race')?.name).toBe('云端新版');
    expect((await storage.getAll()).find((item) => item.id === 'pull-race-conflict')?.name).toContain('GET 期间的新编辑');
    expect(await storage.getGenerationSource('pull-race-conflict')).toEqual(newerSource);
    expect(await storage.getGenerationSource('pull-race')).toBeNull();
  });

  it('409 冲突取云端详情期间的新编辑会完整保存在冲突副本', async () => {
    const remoteProject = makeProject('另一设备', '2026-08-15T00:00:03.000Z');
    const api = new FakeApi([{ id: 'put-race', name: remoteProject.name, project: remoteProject, updatedAt: remoteProject.updatedAt, revision: 1 }]);
    api.listDesignsPage = async () => ({ items: [], nextCursor: null });
    let releaseGet!: () => void;
    api.getDesign = async (id) => new Promise((resolve) => {
      releaseGet = () => resolve(api.cloud.get(id) ?? null);
    });
    const storage = new FakeStorage();
    const original = makeProject('第一次编辑', '2026-08-15T00:00:00.000Z');
    await storage.put(record('put-race', original, original.updatedAt, 0, 'dirty'));

    const syncing = createSyncClient(storage, api, { newId: () => 'put-race-conflict' }).sync();
    await vi.waitFor(() => expect(releaseGet).toBeTypeOf('function'));
    const newest = makeProject('冲突判断期间的新编辑', '2026-08-15T00:00:04.000Z');
    await storage.put(record('put-race', newest, newest.updatedAt, 0, 'dirty'));
    releaseGet();
    const outcome = await syncing;

    expect(outcome.conflictCopies).toEqual([{ originalId: 'put-race', conflictId: 'put-race-conflict' }]);
    expect((await storage.getAll()).find((item) => item.id === 'put-race')?.name).toBe('另一设备');
    expect((await storage.getAll()).find((item) => item.id === 'put-race-conflict')?.name).toContain('冲突判断期间的新编辑');
  });

  it('本地墓碑：deleteLocal 后同步调用云端 DELETE 并清理墓碑', async () => {
    const project = makeProject('待删', '2026-08-15T00:00:00.000Z');
    const api = new FakeApi([{ id: 'd1', name: project.name, project, updatedAt: project.updatedAt, revision: 1 }]);
    const storage = new FakeStorage();
    const source: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([1, 2, 3, 255]).buffer,
    };
    await storage.put(record('d1', project, project.updatedAt, 1, 'synced'), { mode: 'replace', source });
    const client = createSyncClient(storage, api);

    await client.deleteLocal('d1', '2026-08-15T13:00:00.000Z');
    expect(await storage.getAll()).toEqual([]);
    expect(await storage.getGenerationSource('d1')).toBeNull();

    const outcome = await client.sync();
    expect(api.deleted).toEqual(['d1']);
    expect(outcome.pushed).toBe(1);
    // 墓碑已清理：再次同步零操作
    const again = await client.sync();
    expect(again.pushed).toBe(0);
    expect(again.pulled).toBe(0);
  });

  it('墓碑 409 后读取云端失败时保留该墓碑，并继续删除后续设计', async () => {
    const badProject = makeProject('冲突删除', '2026-08-15T00:00:00.000Z');
    const goodProject = makeProject('正常删除', '2026-08-15T00:00:00.000Z');
    const api = new FakeApi([
      { id: 'bad-delete', name: badProject.name, project: badProject, updatedAt: badProject.updatedAt, revision: 2 },
      { id: 'good-delete', name: goodProject.name, project: goodProject, updatedAt: goodProject.updatedAt, revision: 1 },
    ]);
    const originalDelete = api.deleteDesign.bind(api);
    api.deleteDesign = async (id, baseRevision) => {
      if (id === 'bad-delete') throw new ApiError(409, 'REVISION_CONFLICT', '删除冲突');
      return originalDelete(id, baseRevision);
    };
    const originalGet = api.getDesign.bind(api);
    api.getDesign = async (id) => {
      if (id === 'bad-delete') throw new ApiError(503, 'CLOUD_READ_FAILED', '无法读取删除冲突');
      return originalGet(id);
    };
    const storage = new FakeStorage();
    const client = createSyncClient(storage, api);
    await storage.put(record('bad-delete', badProject, badProject.updatedAt, 1, 'synced'));
    await storage.put(record('good-delete', goodProject, goodProject.updatedAt, 1, 'synced'));
    await client.deleteLocal('bad-delete');
    await client.deleteLocal('good-delete');

    const outcome = await client.sync();

    expect(api.deleted).toEqual(['good-delete']);
    expect(outcome.issues).toContainEqual({
      designId: 'bad-delete',
      operation: 'delete',
      code: 'CLOUD_READ_FAILED',
      message: '无法读取删除冲突',
    });
    expect(JSON.parse(storage.meta.get('sync-tombstones-v2') ?? '[]')).toEqual([
      { id: 'bad-delete', baseRevision: 1 },
    ]);
  });

  it('本地 revision 尚未回写时，使用已知云端 revision 删除且不会被云端复活', async () => {
    const project = makeProject('刚同步完成', '2026-08-15T00:00:00.000Z');
    const api = new FakeApi([{ id: 'd2', name: project.name, project, updatedAt: project.updatedAt, revision: 1 }]);
    const storage = new FakeStorage();
    await storage.put(record('d2', project, project.updatedAt, 0, 'dirty'));
    const client = createSyncClient(storage, api);

    await client.deleteLocal('d2', '2026-08-15T13:00:00.000Z', 1);
    expect(await storage.getAll()).toEqual([]);

    const outcome = await client.sync();
    expect(api.deleted).toEqual(['d2']);
    expect(outcome.pushed).toBe(1);
    expect(outcome.pulled).toBe(0);
    expect(api.cloud.has('d2')).toBe(false);
  });

  it('时钟落后的本地删除：墓碑钳制后仍推送（删除不因时钟偏差被云端复活）', async () => {
    // 云端设计 12:00；上次同步基准 12:00；本机时钟落后，删除记作 11:00
    const cloudProject = makeProject('云端版', '2026-08-15T12:00:00.000Z');
    const api = new FakeApi([{ id: 'j1', name: '云端版', project: cloudProject, updatedAt: cloudProject.updatedAt }]);
    const storage = new FakeStorage();
    await storage.setMeta('sync-last-server-time', '2026-08-15T12:00:00.000Z');
    const localProject = makeProject('本地副本', '2026-08-15T12:00:00.000Z');
    await storage.put(record('j1', localProject, localProject.updatedAt, 1, 'synced'));
    const client = createSyncClient(storage, api);

    await client.deleteLocal('j1', '2026-08-15T11:00:00.000Z');
    const outcome = await client.sync();
    // 墓碑被钳制为 maxServer+1ms → 删除胜出：调云端 DELETE，不被拉回复活
    expect(api.deleted).toEqual(['j1']);
    expect(outcome.pushed).toBe(1);
    expect(outcome.pulled).toBe(0);
    expect(await storage.getAll()).toEqual([]);
    // 幂等：下一轮零操作
    const again = await client.sync();
    expect(again.pushed).toBe(0);
    expect(again.pulled).toBe(0);
  });

  it('云端墓碑较新：拉取删除本地副本（跨设备删除收敛）', async () => {
    const cloudProject = makeProject('已删', '2026-08-15T12:00:00.000Z');
    const api = new FakeApi([
      { id: 'h1', name: '已删', project: cloudProject, updatedAt: '2026-08-15T12:00:00.000Z', deleted: true, revision: 2 },
    ]);
    const storage = new FakeStorage();
    const localProject = makeProject('本地副本', '2026-08-15T10:00:00.000Z');
    await storage.put(record('h1', localProject, localProject.updatedAt, 1, 'synced'));
    const client = createSyncClient(storage, api);

    const outcome = await client.sync();
    expect(outcome.pulled).toBe(1);
    expect(outcome.pushed).toBe(0);
    expect(await storage.getAll()).toEqual([]);
  });

  it('云端墓碑列表在途时的新本地编辑会保存为冲突副本', async () => {
    const cloudProject = makeProject('云端已删', '2026-08-15T12:00:00.000Z');
    const api = new FakeApi([
      { id: 'delete-race', name: '云端已删', project: cloudProject, updatedAt: cloudProject.updatedAt, deleted: true, revision: 2 },
    ]);
    let releaseList!: () => void;
    api.listDesignsPage = async () => new Promise((resolve) => {
      releaseList = () => resolve({
        items: [{ id: 'delete-race', name: '', width: 0, height: 0, updatedAt: cloudProject.updatedAt, deleted: true, revision: 2 }],
        nextCursor: null,
      });
    });
    const storage = new FakeStorage();
    const baseline = makeProject('旧基线', '2026-08-15T10:00:00.000Z');
    await storage.put(record('delete-race', baseline, baseline.updatedAt, 1, 'synced'));

    const syncing = createSyncClient(storage, api, { newId: () => 'delete-race-conflict' }).sync();
    await vi.waitFor(() => expect(releaseList).toBeTypeOf('function'));
    const newest = makeProject('列表期间的新编辑', '2026-08-15T13:00:00.000Z');
    await storage.put(record('delete-race', newest, newest.updatedAt, 1, 'dirty'));
    releaseList();
    const outcome = await syncing;

    expect(outcome.conflictCopies).toEqual([{ originalId: 'delete-race', conflictId: 'delete-race-conflict' }]);
    expect((await storage.getAll()).find((item) => item.id === 'delete-race')).toBeUndefined();
    expect((await storage.getAll()).find((item) => item.id === 'delete-race-conflict')?.name).toContain('列表期间的新编辑');
  });

  it('本地较新编辑可复活云端墓碑（E37 扩展：删除与编辑的 LWW）', async () => {
    const cloudProject = makeProject('已删', '2026-08-15T10:00:00.000Z');
    const api = new FakeApi([
      { id: 'i1', name: '已删', project: cloudProject, updatedAt: '2026-08-15T12:00:00.000Z', deleted: true, revision: 1 },
    ]);
    const storage = new FakeStorage();
    const localProject = makeProject('本地复活', '2026-08-15T13:00:00.000Z');
    await storage.put(record('i1', localProject, localProject.updatedAt, 1, 'dirty'));
    const client = createSyncClient(storage, api);

    const outcome = await client.sync();
    expect(outcome.pushed).toBe(1);
    expect(outcome.pulled).toBe(0);
    expect(api.cloud.get('i1')!.name).toBe('本地复活');
    expect(api.cloud.get('i1')!.deleted).toBeFalsy();
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
    expect(await storage.getGenerationSource('e1')).toBeNull();
  });

  it('pullDesign 请求在途出现同 ID 本地保存时保留本地数据与生成源', async () => {
    const remoteProject = makeProject('云端设计', '2026-08-15T08:00:00.000Z');
    const api = new FakeApi([{ id: 'pull-open-race', name: remoteProject.name, project: remoteProject, updatedAt: remoteProject.updatedAt }]);
    const originalGet = api.getDesign.bind(api);
    let releaseGet!: () => void;
    api.getDesign = async (id: string) => new Promise((resolve) => {
      releaseGet = async () => resolve(await originalGet(id));
    });
    const storage = new FakeStorage();
    const client = createSyncClient(storage, api);

    const pulling = client.pullDesign('pull-open-race');
    await vi.waitFor(() => expect(releaseGet).toBeTypeOf('function'));

    const localProject = makeProject('另一标签刚保存', '2026-08-15T09:00:00.000Z');
    const localSource: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([12, 34, 56, 255]).buffer,
    };
    await storage.put(
      record('pull-open-race', localProject, localProject.updatedAt, 0, 'dirty'),
      { mode: 'replace', source: localSource },
    );
    releaseGet();
    await pulling;

    expect(storage.records.get('pull-open-race')?.name).toBe('另一标签刚保存');
    expect(await storage.getGenerationSource('pull-open-race')).toEqual(localSource);
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
