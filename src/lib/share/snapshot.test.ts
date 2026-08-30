import { describe, expect, it } from 'vitest';
import { SHARE_SNAPSHOT_VERSION, parseShareSnapshot, shareSnapshotFromProject } from './snapshot';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import type { ProjectFile } from '@/lib/types';

function project(): ProjectFile {
  return {
    format: 'doupu-project',
    version: 3,
    engineVersion: '2.0.0',
    boardProfile: '2.6mm-52',
    name: '小熊',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    paletteSelection: {
      palette: {
        kind: 'builtin',
        brand: 'pcd:artkal-m-221-official@178dafbc9e77d3de556550dbd058270200129186',
      },
      kitTier: 0,
    },
    params: { ...DEFAULT_GENERATION_PARAMS, brightness: 30 },
    pattern: {
      width: 2,
      height: 1,
      cells: [
        { hex: '#FFF6D4', code: 'MA1', transparent: false },
        { hex: null, code: null, transparent: true },
      ],
    },
  };
}

describe('shareSnapshotFromProject（批次 K）', () => {
  it('只保留看图需要的字段', () => {
    const snapshot = shareSnapshotFromProject(project());
    expect(SHARE_SNAPSHOT_VERSION).toBe(3);
    expect(snapshot).toEqual({
      version: SHARE_SNAPSHOT_VERSION,
      name: '小熊',
      createdAt: '2026-08-01T00:00:00.000Z',
      boardProfile: '2.6mm-52',
      palette: {
        kind: 'builtin',
        brand: 'pcd:artkal-m-221-official@178dafbc9e77d3de556550dbd058270200129186',
      },
      pattern: project().pattern,
    });
  });

  it('保留名称与创建时间，但不携带生成参数及其他项目文件元数据', () => {
    const snapshot = shareSnapshotFromProject(project())!;
    expect(snapshot.name).toBe('小熊');
    expect(snapshot.createdAt).toBe('2026-08-01T00:00:00.000Z');
    expect(snapshot).not.toHaveProperty('params');
    expect(snapshot).not.toHaveProperty('engineVersion');
    expect(snapshot).not.toHaveProperty('updatedAt');
    expect(snapshot).not.toHaveProperty('paletteSelection');
    expect(snapshot).not.toHaveProperty('kitTier');
    expect(JSON.stringify(snapshot)).not.toContain('brightness');
  });

  it('图纸数据不完整时返回 null（调用方回 400，而不是发出一个打不开的链接）', () => {
    expect(shareSnapshotFromProject(null)).toBeNull();
    expect(shareSnapshotFromProject({})).toBeNull();
    expect(shareSnapshotFromProject({ ...project(), pattern: null })).toBeNull();
    // 格子数与宽高不符
    expect(shareSnapshotFromProject({
      ...project(),
      pattern: { width: 3, height: 3, cells: [] },
    })).toBeNull();
    expect(shareSnapshotFromProject({
      ...project(),
      pattern: { width: 1, height: 1, cells: [null] },
    })).toBeNull();
    expect(shareSnapshotFromProject({
      ...project(),
      pattern: {
        width: 1,
        height: 1,
        cells: [{ hex: '#FF0000', code: null, transparent: false }],
      },
    })).toBeNull();
    expect(shareSnapshotFromProject({ ...project(), paletteSelection: undefined })).toBeNull();
    expect(shareSnapshotFromProject({
      ...project(),
      paletteSelection: {
        palette: { kind: 'builtin', brand: 'not-a-palette' },
        kitTier: 0,
      },
    })).toBeNull();
    expect(shareSnapshotFromProject({
      ...project(),
      boardProfile: '5mm-29',
    })).toBeNull();
    expect(shareSnapshotFromProject({
      ...project(),
      pattern: { width: 1, height: 1, cells: [{ hex: '#FFF6D4', code: 'FAKE', transparent: false }] },
    })).toBeNull();
  });

  it('external 背景格不是制作格，换色板后保留旧参考色仍可分享', () => {
    expect(shareSnapshotFromProject({
      ...project(),
      pattern: {
        width: 1,
        height: 1,
        cells: [{ hex: '#FAF4C8', code: 'A01', transparent: false, external: true }],
      },
    })).not.toBeNull();
  });
});

describe('parseShareSnapshot', () => {
  it('往返一致', () => {
    const snapshot = shareSnapshotFromProject(project())!;
    expect(parseShareSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it('只读取 v3，v1 与 v2 快照都拒绝', () => {
    const legacy = {
      version: 1,
      palette: { kind: 'builtin', brand: 'MARD' },
      boardProfile: '5mm-29',
      pattern: {
        width: 1,
        height: 1,
        cells: [{ hex: '#FAF4C8', code: 'A01', transparent: false }],
      },
    };

    expect(parseShareSnapshot(legacy)).toBeNull();
    expect(parseShareSnapshot({ ...legacy, version: 2 })).toBeNull();
  });

  it('v3 快照顶层未知字段必须拒绝', () => {
    const snapshot = shareSnapshotFromProject(project())!;
    expect(parseShareSnapshot({ ...snapshot, futureSnapshotFlag: true })).toBeNull();
  });

  it('v3 快照缺少名称或创建时间必须拒绝', () => {
    const snapshot = shareSnapshotFromProject(project())!;
    const withoutName: Record<string, unknown> = { ...snapshot };
    const withoutCreatedAt: Record<string, unknown> = { ...snapshot };
    delete withoutName.name;
    delete withoutCreatedAt.createdAt;

    expect(parseShareSnapshot(withoutName)).toBeNull();
    expect(parseShareSnapshot(withoutCreatedAt)).toBeNull();
  });

  it('版本不符或数据损坏时返回 null', () => {
    const snapshot = shareSnapshotFromProject(project())!;
    expect(parseShareSnapshot({ ...snapshot, version: 999 })).toBeNull();
    expect(parseShareSnapshot({ ...snapshot, pattern: { width: 2, height: 2, cells: [] } })).toBeNull();
    expect(parseShareSnapshot({
      ...snapshot,
      pattern: { width: 1, height: 1, cells: [null] },
    })).toBeNull();
    expect(parseShareSnapshot({
      ...snapshot,
      palette: { kind: 'builtin', brand: 'not-a-palette' },
    })).toBeNull();
    expect(parseShareSnapshot({ ...snapshot, boardProfile: '2.6mm-51' })).toBeNull();
    expect(parseShareSnapshot({
      ...snapshot,
      palette: { kind: 'builtin', brand: 'MARD' },
    })).toBeNull();
    expect(parseShareSnapshot({
      ...snapshot,
      pattern: { width: 1, height: 1, cells: [{ hex: '#FFF6D4', code: 'FAKE', transparent: false }] },
    })).toBeNull();
    expect(parseShareSnapshot('nope')).toBeNull();
  });
});
