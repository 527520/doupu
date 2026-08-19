import { describe, expect, it } from 'vitest';
import { createSyncClient, ApiError, type CloudApi, type CloudDesignFull, type CloudDesignMeta } from './clientAdapter';
import type {
  DesignRecord,
  GenerationSourceWrite,
  LocalGenerationSourceV1,
  StorageAdapter,
} from '@/lib/storage';
import type { ProjectFile } from '@/lib/types';

const at = (second: number) => `2026-08-17T00:00:${String(second).padStart(2, '0')}.000Z`;

function project(name: string, updatedAt: string): ProjectFile {
  return {
    format: 'doupu-project', version: 2, engineVersion: '2.0.0', name,
    createdAt: at(0), updatedAt,
    palette: { kind: 'builtin', brand: 'MARD' },
    params: { targetWidth: 20, targetColorCount: 2, dithering: false, mode: 'dominant', brightness: 0, contrast: 0, backgroundRemoval: false, bgTolerance: 8 },
    pattern: { width: 1, height: 1, cells: [{ hex: '#000000', code: 'A', transparent: false }] },
  };
}

class MemoryStorage implements StorageAdapter {
  records = new Map<string, DesignRecord>();
  meta = new Map<string, string>();
  sources = new Map<string, LocalGenerationSourceV1>();
  async getAll() { return [...this.records.values()]; }
  async getGenerationSource(id: string) {
    const source = this.sources.get(id);
    return source ? structuredClone(source) : null;
  }
  async put(record: DesignRecord, sourceWrite: GenerationSourceWrite = { mode: 'preserve' }) {
    this.records.set(record.id, structuredClone(record));
    if (sourceWrite.mode === 'replace') this.sources.set(record.id, structuredClone(sourceWrite.source));
    if (sourceWrite.mode === 'clear') this.sources.delete(record.id);
  }
  async delete(id: string) { this.records.delete(id); this.sources.delete(id); }
  async getMeta(key: string) { return this.meta.get(key) ?? null; }
  async setMeta(key: string, value: string) { this.meta.set(key, value); }
}

class RevisionCloud implements CloudApi {
  rows = new Map<string, CloudDesignFull>();
  failAfterCommit = false;
  pageCalls = 0;

  async listDesignsPage(cursor?: string) {
    this.pageCalls++;
    const all: CloudDesignMeta[] = [...this.rows.values()].map((row) => ({
      id: row.id, name: row.name, width: row.project.pattern.width, height: row.project.pattern.height,
      updatedAt: row.updatedAt, deleted: Boolean(row.deleted), revision: row.revision,
    }));
    return cursor ? { items: all.slice(50), nextCursor: null } : { items: all.slice(0, 50), nextCursor: all.length > 50 ? 'next' : null };
  }
  async getDesign(id: string) { return this.rows.get(id) ?? null; }
  async putDesign(id: string, name: string, value: ProjectFile, baseRevision: number) {
    const current = this.rows.get(id);
    if ((current?.revision ?? 0) !== baseRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'conflict');
    const revision = baseRevision + 1;
    const updatedAt = at(revision);
    this.rows.set(id, { id, name, project: { ...value, updatedAt }, updatedAt, revision });
    if (this.failAfterCommit) {
      this.failAfterCommit = false;
      throw new TypeError('network timeout');
    }
    return { updatedAt, revision };
  }
  async deleteDesign(id: string, baseRevision: number) {
    const current = this.rows.get(id);
    if (!current || current.revision !== baseRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'conflict');
    this.rows.delete(id);
    return { updatedAt: at(baseRevision + 1), revision: baseRevision + 1 };
  }
}

function local(id: string, name: string, revision: number, syncState: DesignRecord['syncState'] = 'dirty'): DesignRecord {
  const value = project(name, at(Math.max(0, revision)));
  return { id, name, projectJson: JSON.stringify(value), thumbnail: null, updatedAt: value.updatedAt, revision, syncState };
}

describe('revision/CAS client contract', () => {
  it('paginates once through 100+ cloud entries without duplicates', async () => {
    const api = new RevisionCloud();
    for (let i = 0; i < 101; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const value = project(`D${i}`, at(1));
      api.rows.set(id, { id, name: value.name, project: value, updatedAt: at(1), revision: 1 });
    }
    const storage = new MemoryStorage();
    const outcome = await createSyncClient(storage, api).sync();
    expect(outcome.pulled).toBe(101);
    expect(new Set((await storage.getAll()).map((row) => row.id)).size).toBe(101);
    expect(api.pageCalls).toBe(2);
  });

  it('two-device CAS preserves cloud original and creates a labelled local conflict copy', async () => {
    const api = new RevisionCloud();
    const cloud = project('设备 A', at(2));
    api.rows.set('same', { id: 'same', name: cloud.name, project: cloud, updatedAt: at(2), revision: 2 });
    const storage = new MemoryStorage();
    await storage.put(local('same', '设备 B', 1));

    const outcome = await createSyncClient(storage, api, { newId: () => 'conflict-copy' }).sync();

    expect(outcome.conflictCopies).toEqual([{ originalId: 'same', conflictId: 'conflict-copy' }]);
    expect(api.rows.get('same')?.name).toBe('设备 A');
    expect(storage.records.get('same')?.name).toBe('设备 A');
    expect(storage.records.get('conflict-copy')?.name).toContain('冲突副本');
    expect(storage.records.get('conflict-copy')?.revision).toBe(0);
    expect(storage.records.get('conflict-copy')?.syncState).toBe('conflict');
  });

  it('timeout after successful PUT is recognized as idempotent on retry, not a conflict copy', async () => {
    const api = new RevisionCloud();
    const storage = new MemoryStorage();
    const source: LocalGenerationSourceV1 = {
      version: 1,
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([1, 2, 3, 255]).buffer,
    };
    await storage.put(local('retry', '只提交一次', 0), { mode: 'replace', source });
    api.failAfterCommit = true;
    const client = createSyncClient(storage, api, { newId: () => 'must-not-create' });

    expect((await client.sync()).errors).toHaveLength(1);
    const retry = await client.sync();
    expect(retry.conflictCopies).toEqual([]);
    expect(storage.records.has('must-not-create')).toBe(false);
    expect(storage.records.get('retry')?.revision).toBe(1);
    expect(storage.records.get('retry')?.syncState).toBe('synced');
    expect(await storage.getGenerationSource('retry')).toEqual(source);
  });

  it('uploads a new conflict copy once while preserving its visible conflict state', async () => {
    const api = new RevisionCloud();
    const storage = new MemoryStorage();
    await storage.put(local('conflict-local', '待确认的冲突副本', 0, 'conflict'));
    const client = createSyncClient(storage, api);

    const first = await client.sync();
    expect(first.pushed).toBe(1);
    expect(api.rows.get('conflict-local')?.name).toBe('待确认的冲突副本');
    expect(storage.records.get('conflict-local')).toEqual(expect.objectContaining({
      revision: 1,
      syncState: 'conflict',
    }));

    const second = await client.sync();
    expect(second.pushed).toBe(0);
    expect(api.rows.get('conflict-local')?.revision).toBe(1);
    expect(storage.records.get('conflict-local')?.syncState).toBe('conflict');
  });
});
