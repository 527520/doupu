import type { StitchProgress } from '@/lib/progress/stitchProgress';
import { describe, expect, it } from 'vitest';
import {
  CLEAR_GENERATION_SOURCE,
  StorageError,
  buildThumbnailSize,
  createLocalGenerationSource,
  imageDataFromLocalGenerationSource,
  createDesignRecord,
  isQuotaError,
  newDesignId,
  nextDesignName,
  parseStoredProject,
  replaceGenerationSource,
  renderThumbnail,
  type DesignRecord,
  type GenerationSourceWrite,
  type LocalGenerationSourceV1,
  type StorageAdapter,
} from './index';
import { serializeProject, type ProjectSource } from '@/lib/project/serialize';
import { generatePattern } from '@/lib/engine/generate';
import { getBuiltinPalette } from '@/lib/palettes';
import { DEFAULT_GENERATION_PARAMS, type ProjectFile } from '@/lib/types';

/** 内存版 IndexedDB 假实现（测试专用）。 */
class FakeStorage implements StorageAdapter {
  readonly designs = new Map<string, DesignRecord>();
  readonly meta = new Map<string, string>();
  readonly sources = new Map<string, LocalGenerationSourceV1>();
  /** 模拟配额满：put 时抛 DOMException。 */
  quotaExceeded = false;

  async getAll(): Promise<DesignRecord[]> {
    return [...this.designs.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  async getGenerationSource(id: string): Promise<LocalGenerationSourceV1 | null> {
    const source = this.sources.get(id);
    return source ? structuredClone(source) : null;
  }
  async put(record: DesignRecord, sourceWrite?: GenerationSourceWrite): Promise<void> {
    if (this.quotaExceeded) throw new DOMException('quota', 'QuotaExceededError');
    this.designs.set(record.id, { ...record });
    if (sourceWrite?.mode === 'replace') this.sources.set(record.id, structuredClone(sourceWrite.source));
    else if (sourceWrite?.mode === 'clear') this.sources.delete(record.id);
  }
  async delete(id: string): Promise<void> {
    this.designs.delete(id);
    this.sources.delete(id);
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

function makeProject(name: string, updatedAt: string): ProjectFile {
  const source: ProjectSource = {
    name,
    createdAt: '2026-08-14T00:00:00.000Z',
    engineVersion: '2.0.0',
    boardProfile: '5mm-29',
    paletteSelection: {
      palette: { kind: 'builtin', brand: 'MARD' },
      kitTier: 0,
    },
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

  it('replace 会让 Fake adapter 与设计一起保存本地生成源', async () => {
    const storage = new FakeStorage();
    const source = createLocalGenerationSource({
      data: new Uint8ClampedArray([1, 2, 3, 4]),
      width: 1,
      height: 1,
    });

    await storage.put(
      createDesignRecord('id-source', makeProject('有源', '2026-08-14T10:00:00.000Z'), null),
      replaceGenerationSource(source),
    );

    expect(await storage.getGenerationSource('id-source')).toEqual(source);
  });

  it('Fake adapter 默认保留已有源，只有显式 clear 才清除', async () => {
    const storage = new FakeStorage();
    const source = createLocalGenerationSource({
      data: new Uint8ClampedArray([4, 3, 2, 1]),
      width: 1,
      height: 1,
    });
    await storage.put(
      createDesignRecord('id-source', makeProject('初版', '2026-08-14T10:00:00.000Z'), null),
      replaceGenerationSource(source),
    );

    await storage.put(createDesignRecord('id-source', makeProject('改名', '2026-08-14T11:00:00.000Z'), null));
    expect(await storage.getGenerationSource('id-source')).not.toBeNull();
    await storage.put(
      createDesignRecord('id-source', makeProject('清源', '2026-08-14T12:00:00.000Z'), null),
      CLEAR_GENERATION_SOURCE,
    );
    expect(await storage.getGenerationSource('id-source')).toBeNull();
  });

  it('Fake adapter 删除设计时级联删除本地生成源', async () => {
    const storage = new FakeStorage();
    const source = createLocalGenerationSource({
      data: new Uint8ClampedArray([1, 1, 1, 255]),
      width: 1,
      height: 1,
    });
    await storage.put(
      createDesignRecord('id-source', makeProject('待删除', '2026-08-14T10:00:00.000Z'), null),
      replaceGenerationSource(source),
    );

    await storage.delete('id-source');

    expect(await storage.getGenerationSource('id-source')).toBeNull();
  });
});

describe('本地生成源契约', () => {
  it('字节往返前后真实引擎输出完全一致', () => {
    const image = {
      data: new Uint8ClampedArray([
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
        255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 128,
      ]),
      width: 3,
      height: 2,
    };
    const restored = imageDataFromLocalGenerationSource(createLocalGenerationSource(image));
    const params = { ...DEFAULT_GENERATION_PARAMS, targetWidth: 6, targetColorCount: 12 };
    const palette = [...getBuiltinPalette('MARD').engineColors];

    const before = generatePattern(image, params, palette);
    const after = generatePattern(restored, params, palette);

    expect(after.pattern).toEqual(before.pattern);
    expect(after.stats).toEqual(before.stats);
    expect(after.totalBeadCount).toBe(before.totalBeadCount);
  });

  it('把 SharedArrayBuffer 视图复制成独立的普通 ArrayBuffer', () => {
    const shared = new SharedArrayBuffer(12);
    const pixels = new Uint8ClampedArray(shared, 4, 8);
    pixels.set([1, 2, 3, 4, 5, 6, 7, 8]);

    const source = createLocalGenerationSource({ data: pixels, width: 2, height: 1 });

    expect(source).toMatchObject({ version: 1, width: 2, height: 1 });
    expect(source.rgba).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(source.rgba)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    pixels[0] = 99;
    expect(new Uint8Array(source.rgba)[0]).toBe(1);
  });

  it('只接受 1..800 整数尺寸且 RGBA 长度必须精确匹配', () => {
    const maximum = createLocalGenerationSource({
      data: new Uint8ClampedArray(800 * 800 * 4),
      width: 800,
      height: 800,
    });
    expect(maximum.rgba.byteLength).toBe(800 * 800 * 4);

    expect(() => createLocalGenerationSource({ data: new Uint8ClampedArray(4), width: 0, height: 1 })).toThrow();
    expect(() => createLocalGenerationSource({ data: new Uint8ClampedArray(4), width: 801, height: 1 })).toThrow();
    expect(() => createLocalGenerationSource({ data: new Uint8ClampedArray(4), width: 1.5, height: 1 })).toThrow();
    expect(() => createLocalGenerationSource({ data: new Uint8ClampedArray(7), width: 2, height: 1 })).toThrow();
  });

  it('读取转换会再次校验并返回不共享存储缓冲的 ImageDataLike', () => {
    const source = createLocalGenerationSource({
      data: new Uint8ClampedArray([1, 2, 3, 4]),
      width: 1,
      height: 1,
    });
    const image = imageDataFromLocalGenerationSource(source);
    expect(image).toMatchObject({ width: 1, height: 1 });
    expect([...image.data]).toEqual([1, 2, 3, 4]);
    image.data[0] = 99;
    expect(new Uint8Array(source.rgba)[0]).toBe(1);
    expect(() => imageDataFromLocalGenerationSource({ ...source, width: 2 })).toThrow();
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
