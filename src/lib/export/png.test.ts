import { describe, expect, it } from 'vitest';
import { exportPngBlob } from './png';
import type { Pattern, PatternCell } from '@/lib/types';

const transparent: PatternCell = { hex: null, code: null, transparent: true };
const external = (hex: string): PatternCell => ({ hex, code: 'A', transparent: false, external: true });

function makePattern(w: number, h: number, cells: PatternCell[]): Pattern {
  return { width: w, height: h, cells };
}

describe('exportPngBlob（Node 环境：空图纸分支不触碰 DOM）', () => {
  it('全透明图纸 → EMPTY_PATTERN（E10）', async () => {
    const p = makePattern(2, 2, [transparent, transparent, transparent, transparent]);
    const result = await exportPngBlob(p, '设计', {});
    expect(result).toEqual({ ok: false, code: 'EMPTY_PATTERN' });
  });

  it('全外部图纸 → EMPTY_PATTERN（E24）', async () => {
    const p = makePattern(2, 2, [
      external('#000000'),
      external('#000000'),
      external('#000000'),
      external('#000000'),
    ]);
    const result = await exportPngBlob(p, '设计', {});
    expect(result).toEqual({ ok: false, code: 'EMPTY_PATTERN' });
  });

  it('1×1 全透明 → EMPTY_PATTERN', async () => {
    const p = makePattern(1, 1, [transparent]);
    expect(await exportPngBlob(p, '', {})).toEqual({ ok: false, code: 'EMPTY_PATTERN' });
  });

  it('透明+外部混合 → EMPTY_PATTERN', async () => {
    const p = makePattern(2, 2, [transparent, external('#111111'), transparent, transparent]);
    expect(await exportPngBlob(p, 'x', {})).toEqual({ ok: false, code: 'EMPTY_PATTERN' });
  });

  it('空 cells 数组（0×0 边界防御）→ EMPTY_PATTERN', async () => {
    const p = makePattern(0, 0, []);
    expect(await exportPngBlob(p, 'x', {})).toEqual({ ok: false, code: 'EMPTY_PATTERN' });
  });
});
