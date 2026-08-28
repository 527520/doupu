import { describe, expect, it } from 'vitest';
import { SHARE_SNAPSHOT_VERSION, parseShareSnapshot, shareSnapshotFromProject } from './snapshot';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import type { ProjectFile } from '@/lib/types';

function project(): ProjectFile {
  return {
    format: 'doupu-project',
    version: 2,
    engineVersion: '2.0.0',
    name: '小熊',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    palette: { kind: 'builtin', brand: 'MARD' },
    params: { ...DEFAULT_GENERATION_PARAMS, brightness: 30 },
    pattern: {
      width: 2,
      height: 1,
      cells: [
        { hex: '#FF0000', code: 'A', transparent: false },
        { hex: null, code: null, transparent: true },
      ],
    },
  };
}

describe('shareSnapshotFromProject（批次 K）', () => {
  it('只保留看图需要的字段', () => {
    const snapshot = shareSnapshotFromProject(project());
    expect(snapshot).toEqual({
      version: SHARE_SNAPSHOT_VERSION,
      name: '小熊',
      createdAt: '2026-08-01T00:00:00.000Z',
      palette: { kind: 'builtin', brand: 'MARD' },
      pattern: project().pattern,
    });
  });

  it('不携带生成参数与项目文件元数据（对看图的人无意义，且会暴露作者调参习惯）', () => {
    const snapshot = shareSnapshotFromProject(project())!;
    expect(snapshot).not.toHaveProperty('params');
    expect(snapshot).not.toHaveProperty('engineVersion');
    expect(snapshot).not.toHaveProperty('updatedAt');
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
    expect(shareSnapshotFromProject({ ...project(), palette: undefined })).toBeNull();
  });
});

describe('parseShareSnapshot', () => {
  it('往返一致', () => {
    const snapshot = shareSnapshotFromProject(project())!;
    expect(parseShareSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it('版本不符或数据损坏时返回 null（老链接不会渲染出错乱的图）', () => {
    const snapshot = shareSnapshotFromProject(project())!;
    expect(parseShareSnapshot({ ...snapshot, version: 999 })).toBeNull();
    expect(parseShareSnapshot({ ...snapshot, pattern: { width: 2, height: 2, cells: [] } })).toBeNull();
    expect(parseShareSnapshot('nope')).toBeNull();
  });
});
