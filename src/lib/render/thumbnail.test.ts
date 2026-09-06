import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Pattern, PatternCell } from '@/lib/types';
import { encodeRgbPng } from './png';
import { rasterizePattern, renderPatternThumbnail, ThumbnailCache } from './thumbnail';
import { thumbnailCellSize, thumbnailPixelSize } from './thumbnailSize';

const cell = (hex: string | null, extra: Partial<PatternCell> = {}): PatternCell => ({ hex, code: hex ? 'C1' : null, transparent: hex === null && !extra.external, external: false, ...extra } as PatternCell);
const pattern = (width: number, height: number, fill: (x: number, y: number) => PatternCell): Pattern => ({
  width, height, cells: Array.from({ length: width * height }, (_, index) => fill(index % width, Math.floor(index / width))),
} as Pattern);

describe('thumbnail sizing', () => {
  it('scales the cell so the longest edge approaches the target while staying inside bounds', () => {
    expect(thumbnailCellSize(29, 29)).toBe(16);
    expect(thumbnailCellSize(116, 134)).toBe(5);
    expect(thumbnailCellSize(200, 200)).toBe(3);
    expect(thumbnailCellSize(400, 10)).toBe(2);
    expect(thumbnailPixelSize(116, 134)).toEqual({ width: 580, height: 670 });
  });
});

describe('rasterizePattern', () => {
  it('fills cells, paints background for transparent cells and darkens grid lines', () => {
    const image = rasterizePattern(pattern(2, 1, (x) => (x === 0 ? cell('#FF0000') : cell(null))), { boardSize: 29 });
    const cellPx = thumbnailCellSize(2, 1);
    expect(image.width).toBe(2 * cellPx);
    expect(image.height).toBe(cellPx);
    const pixel = (x: number, y: number) => Array.from(image.data.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3));
    // 格子内部保持原色，边缘格线变暗
    expect(pixel(2, 2)).toEqual([255, 0, 0]);
    expect(pixel(0, 2)).toEqual([Math.round(255 * 0.82), 0, 0]);
    // 透明格使用纸白背景
    expect(pixel(cellPx + 2, 2)).toEqual([0xf5, 0xf1, 0xeb]);
  });

  it('draws board seams at board boundaries only', () => {
    const image = rasterizePattern(pattern(4, 1, () => cell('#FFFFFF')), { boardSize: 2 });
    const cellPx = thumbnailCellSize(4, 1);
    const pixel = (x: number) => image.data[(2 * image.width + x) * 3];
    // 板缝在 x = 2 * cellPx，且比普通格线更深
    expect(pixel(2 * cellPx)).toBeLessThan(pixel(cellPx));
    expect(pixel(3 * cellPx)).toBe(pixel(cellPx));
  });
});

describe('encodeRgbPng', () => {
  it('produces a valid PNG whose IDAT decodes to filter-0 scanlines', () => {
    const png = encodeRgbPng({ width: 2, height: 1, data: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.toString('latin1', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(1);
    const idatLength = png.readUInt32BE(33);
    expect(png.toString('latin1', 37, 41)).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect(Array.from(raw)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(png.toString('latin1', png.length - 8, png.length - 4)).toBe('IEND');
  });

  it('renders a full pattern to PNG bytes', () => {
    const png = renderPatternThumbnail(pattern(29, 29, (x, y) => cell((x + y) % 2 ? '#112233' : '#FFEEDD')), { boardSize: 29 });
    expect(png.length).toBeGreaterThan(100);
    expect(png.toString('latin1', 1, 4)).toBe('PNG');
  });
});

describe('ThumbnailCache', () => {
  it('evicts the least recently used entries once the byte budget is exceeded', () => {
    const cache = new ThumbnailCache(10);
    cache.set('a', Buffer.alloc(4));
    cache.set('b', Buffer.alloc(4));
    expect(cache.get('a')).toBeDefined();
    cache.set('c', Buffer.alloc(4));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
    expect(cache.size).toBe(2);
  });
});
