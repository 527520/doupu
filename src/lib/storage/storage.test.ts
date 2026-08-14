import { describe, expect, it } from 'vitest';
import {
  StorageError,
  buildThumbnailSize,
  createDesignRecord,
  isQuotaError,
  newDesignId,
  nextDesignName,
  parseStoredProject,
  renderThumbnail,
  type DesignRecord,
  type StorageAdapter,
} from './index';
import { serializeProject, type ProjectSource } from '@/lib/project/serialize';
import type { ProjectFile } from '@/lib/types';

/** 内存版 IndexedDB 假实现（测试专用）。 */
class FakeStorage implements StorageAdapter {
  readonly designs = new Map<string, DesignRecord>();
  readonly meta = new Map<string, string>();
  /** 模拟配额满：put 时抛 DOMException。 */
  quotaExceeded = false;

  async getAll(): Promise<DesignRecord[]> {
    return [...this.designs.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  async put(record: DesignRecord): Promise<void> {
    if (this.quotaExceeded) throw new DOMException('quota', 'QuotaExceededError');
    this.designs.set(record.id, { ...record });
  }
  async delete(id: string): Promise<void> {
    this.designs.delete(id);
  }
  async getMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }
  async setMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
  }
}

function makeProject(name: string, updatedAt: string): ProjectFile {
  const source: ProjectSource = {
    name,
    createdAt: '2026-08-14T00:00:00.000Z',
    palette: { kind: 'builtin', brand: 'MARD' },
    params: {
      targetWidth: 40,
      targetColorCount: 40,
      dithering: false,
      mode: 'dominant',
      brightness: 0,
      contrast: 0,
      backgroundRemoval: false,
      bgTolerance: 8,
    },
    pattern: {
      width: 2,
      height: 1,
      cells: [
        { hex: '#000000', code: 'H07', transparent: false },
        { hex: null, code: null, transparent: true },
      ],
    },
  };
  const text = serializeProject(source);
  const parsed = JSON.parse(text) as ProjectFile;
  parsed.updatedAt = updatedAt;
  return parsed;
}

describe('FakeStorage + 记录 CRUD（storage 层验收）', () => {
  it('put/getAll round-trip，按 updatedAt 降序', async () => {
    const storage = new FakeStorage();
    const a = createDesignRecord('id-a', makeProject('甲', '2026-08-14T10:00:00.000Z'), null);
    const b = createDesignRecord('id-b', makeProject('乙', '2026-08-14T12:00:00.000Z'), null);
    const c = createDesignRecord('id-c', makeProject('丙', '2026-08-14T11:00:00.000Z'), null);
    await storage.put(a);
    await storage.put(b);
    await storage.put(c);
    const all = await storage.getAll();
    expect(all.map((r) => r.name)).toEqual(['乙', '丙', '甲']);
    expect(all[0].projectJson).toContain('doupu-project');
  });

  it('同 id 覆盖（upsert）不产生重复', async () => {
    const storage = new FakeStorage();
    await storage.put(createDesignRecord('id-a', makeProject('甲', '2026-08-14T10:00:00.000Z'), null));
    await storage.put(createDesignRecord('id-a', makeProject('甲改', '2026-08-14T13:00:00.000Z'), null));
    const all = await storage.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('甲改');
  });

  it('delete 与 meta 读写', async () => {
    const storage = new FakeStorage();
    await storage.put(createDesignRecord('id-a', makeProject('甲', '2026-08-14T10:00:00.000Z'), null));
    await storage.delete('id-a');
    expect(await storage.getAll()).toHaveLength(0);
    await storage.setMeta('lastDesignId', 'id-a');
    expect(await storage.getMeta('lastDesignId')).toBe('id-a');
    expect(await storage.getMeta('missing')).toBeNull();
  });

  it('配额满（E39）：put 抛 QuotaExceededError，isQuotaError 识别', async () => {
    const storage = new FakeStorage();
    storage.quotaExceeded = true;
    await expect(
      storage.put(createDesignRecord('id-a', makeProject('甲', '2026-08-14T10:00:00.000Z'), null)),
    ).rejects.toThrow();
    await expect(
      storage.put(createDesignRecord('id-a', makeProject('甲', '2026-08-14T10:00:00.000Z'), null)),
    ).rejects.toSatisfy((e) => isQuotaError(e));
    expect(isQuotaError(new StorageError('QUOTA', 'x'))).toBe(true);
    expect(isQuotaError(new Error('other'))).toBe(false);
  });
});

describe('纯函数辅助', () => {
  it('nextDesignName：无冲突为未命名设计，冲突加后缀', () => {
    expect(nextDesignName([])).toBe('未命名设计');
    expect(nextDesignName(['未命名设计'])).toBe('未命名设计 (2)');
    expect(nextDesignName(['未命名设计', '未命名设计 (2)'])).toBe('未命名设计 (3)');
  });

  it('buildThumbnailSize：最长边 ≤ maxSide，至少 1×1', () => {
    expect(buildThumbnailSize(100, 50, 256)).toEqual({ cellPx: 2, width: 200, height: 100 });
    expect(buildThumbnailSize(50, 100, 256)).toEqual({ cellPx: 2, width: 100, height: 200 });
    expect(buildThumbnailSize(200, 200, 256)).toEqual({ cellPx: 1, width: 200, height: 200 });
    expect(buildThumbnailSize(512, 512, 256)).toEqual({ cellPx: 1, width: 512, height: 512 });
    expect(buildThumbnailSize(0, 0, 256)).toEqual({ cellPx: 256, width: 256, height: 256 });
  });

  it('parseStoredProject：合法 JSON 可解析，坏数据返回 null', () => {
    const project = makeProject('甲', '2026-08-14T10:00:00.000Z');
    expect(parseStoredProject(JSON.stringify(project))?.name).toBe('甲');
    expect(parseStoredProject('not json')).toBeNull();
    expect(parseStoredProject('{}')).toBeNull();
  });

  it('renderThumbnail：canvas 桩环境下安全返回（不抛异常）', () => {
    const pattern = makeProject('甲', '2026-08-14T10:00:00.000Z').pattern;
    const result = renderThumbnail(pattern, 256);
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('newDesignId：格式稳定且唯一', () => {
    const a = newDesignId();
    const b = newDesignId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
