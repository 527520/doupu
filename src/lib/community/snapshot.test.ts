import { describe, expect, it } from 'vitest';
import { DEFAULT_GENERATION_PARAMS, type ProjectFile } from '@/lib/types';
import {
  communitySnapshotFromProject,
  deriveCommunityPreview,
  parseCommunitySnapshot,
  snapshotColorCount,
} from './snapshot';

function project(width = 2, height = 2): ProjectFile {
  const colors = [
    { hex: '#FF0000', code: 'R1' },
    { hex: '#00FF00', code: 'G1' },
  ];
  return {
    format: 'doupu-project',
    version: 3,
    engineVersion: 'test',
    boardProfile: '5mm-29',
    name: 'private name',
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    paletteSelection: { palette: { kind: 'custom', colors }, kitTier: 0 },
    params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: Math.max(20, width), targetColorCount: 2 },
    pattern: {
      width,
      height,
      cells: Array.from({ length: width * height }, (_, index) => ({
        ...colors[index % colors.length], transparent: false,
      })),
    },
  };
}

describe('community frozen snapshots', () => {
  it('copies only the public protocol and rejects private or malformed fields', () => {
    const source = project();
    const snapshot = communitySnapshotFromProject(source)!;
    expect(snapshot).not.toHaveProperty('name');
    expect(JSON.stringify(snapshot)).not.toContain('private name');
    source.pattern.cells[0].hex = '#00FF00';
    expect(snapshot.pattern.cells[0].hex).toBe('#FF0000');
    expect(parseCommunitySnapshot({ ...snapshot, privateDesignId: crypto.randomUUID() })).toBeNull();
    expect(snapshotColorCount(snapshot)).toBe(2);
  });

  it('derives a bounded deterministic preview and an actual-color band', () => {
    const preview = deriveCommunityPreview(project(200, 100).pattern);
    expect(preview).toMatchObject({ width: 48, height: 24, originalWidth: 200, originalHeight: 100 });
    expect(preview.cells).toHaveLength(48 * 24);
    expect(preview.colorBand).toEqual(['#00FF00', '#FF0000']);
  });
});
