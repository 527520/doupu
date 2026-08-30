// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deletePalette, getPaletteColors, listPalettes, savePalette } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('palette revision API client', () => {
  it('工作台投影统一剔除历史占位色号并裁剪合法色号', () => {
    expect(getPaletteColors({
      id: 'legacy',
      name: '旧云色板',
      updatedAt: 'x',
      revision: 1,
      colors: [
        { code: ' A01 ', hex: '#112233' },
        { code: '?', hex: '#223344' },
        { code: 'UNKNOWN', hex: '#334455' },
        { code: 'UNKNOWN_01', hex: '#445566' },
      ],
    })).toEqual([{ code: 'A01', hex: '#112233' }]);
  });

  it('walks cursor pages and hides tombstones', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'a', name: 'A', colors: [], updatedAt: 'x', revision: 1 }, { id: 'gone', name: '', colors: [], updatedAt: 'x', revision: 2, deleted: true }], nextCursor: 'next' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'b', name: 'B', colors: [], updatedAt: 'y', revision: 1 }], nextCursor: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await listPalettes()).map((row) => row.id)).toEqual(['a', 'b']);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/palettes?cursor=next');
  });

  it('sends baseRevision on PUT and DELETE', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'p', name: 'P', colors: [], updatedAt: 'x', revision: 4 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 5 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await savePalette('p', 'P', [{ code: 'A', hex: '#000000' }], 3);
    await deletePalette('p', 4);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ baseRevision: 3 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ baseRevision: 4 });
  });
});
