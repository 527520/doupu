import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultBoardProfileForPalette } from '@/lib/boardProfiles';
import { generatePattern } from '@/lib/engine/generate';
import { selectKitColors } from '@/lib/engine/kit';
import { remapPattern } from '@/lib/engine/remap';
import type { ImageDataLike } from '@/lib/engine/types';
import { serializeProject } from '@/lib/project/serialize';
import { parseProjectFile } from '@/lib/schemas';
import { DEFAULT_GENERATION_PARAMS, BRANDS, type Brand, type PaletteColor } from '@/lib/types';
import { getBuiltinPalette, listBuiltinPalettes } from './index';

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { data, width, height };
}

function rgb(hex: string): readonly [number, number, number, 255] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

const legacyFixture = image(20, 12, (x, y) => [
  (x * 37 + y * 17) % 256,
  (x * 11 + y * 53) % 256,
  (x * 71 + y * 7) % 256,
  (x + y) % 13 === 0 ? 0 : 255,
]);

const legacyParams = {
  ...DEFAULT_GENERATION_PARAMS,
  targetWidth: 20,
  targetColorCount: 16,
  dithering: true,
  mode: 'average' as const,
};

const LEGACY_OUTPUT_HASHES: Record<Brand, string> = {
  MARD: '35ea8a51b06787ab89274cb8aaddaa0cd364650be97b71ced6b8483eb3d407f1',
  COCO: '0c4f8e9a8734d0de6e7b4ee062c2ebfbacd8608dbc37e63a926c921526233446',
  漫漫: '52104cb6e99bdac960820d79db8cb8430755a6c0fe0876f39220d3e14a4ec8f7',
  盼盼: '9a80376e4a26b484dd87956688a4cedeb37f9e6a2881a2c54f001b0211a77236',
  咪小窝: 'dc168333cb0f259402c8ab78a2713a73ae6008af68044a6e265a2f8b73924311',
};

describe('色板目录与引擎的集成不变量', () => {
  for (const brand of BRANDS) {
    it(`${brand} 经典目录生成结果命中 golden`, () => {
      const catalog = generatePattern(
        legacyFixture,
        legacyParams,
        [...getBuiltinPalette(brand).engineColors],
      );
      expect(createHash('sha256').update(JSON.stringify(catalog)).digest('hex')).toBe(
        LEGACY_OUTPUT_HASHES[brand],
      );
    });
  }

  it('漫漫 #F3C1C0 精确色生成为 S7 并命中纠错 golden', () => {
    const source = image(1, 1, () => rgb('#F3C1C0'));
    const generated = generatePattern(
      source,
      {
        ...DEFAULT_GENERATION_PARAMS,
        targetWidth: 1,
        targetColorCount: 1,
        dithering: false,
        backgroundRemoval: false,
        mode: 'average',
      },
      [...getBuiltinPalette('漫漫').engineColors],
    );

    expect(generated.pattern.cells).toEqual([
      expect.objectContaining({ code: 'S7', hex: '#F3C1C0' }),
    ]);
    expect(createHash('sha256').update(JSON.stringify(generated)).digest('hex')).toBe(
      'dbf7bf46c7c3a5b683ce07cdc309e52c33e2440736294be917a2ee7ee4d4134e',
    );
  });

  it('13 套色板均贯通套装筛选、生成、重映射与项目往返', () => {
    for (const summary of listBuiltinPalettes()) {
      const full = [...getBuiltinPalette(summary.id).engineColors];
      const kit = selectKitColors(full, 24);
      expect(kit).toHaveLength(Math.min(24, full.length));
      const samples: PaletteColor[] = [kit[0], kit[Math.floor(kit.length / 2)], kit.at(-1)!];
      const source = image(20, 5, (x) => rgb(samples[x % samples.length].hex));
      const params = {
        ...DEFAULT_GENERATION_PARAMS,
        targetWidth: 20,
        targetColorCount: 3,
        mode: 'average' as const,
      };

      const generated = generatePattern(source, params, kit);
      const remapped = remapPattern(generated.pattern, kit);
      const availableIdentities = new Set(
        full.map((color) => `${color.code}\u0000${color.hex.toUpperCase()}`),
      );
      for (const cell of remapped.pattern.cells) {
        if (cell.transparent || cell.external) continue;
        expect(cell.code, summary.id).not.toBeNull();
        expect(cell.hex, summary.id).not.toBeNull();
        expect(cell.code, summary.id).not.toMatch(/^UNKNOWN(?:[-_]|$)|^\?$/i);
        expect(
          availableIdentities.has(`${cell.code}\u0000${cell.hex!.toUpperCase()}`),
          summary.id,
        ).toBe(true);
      }

      const projectPalette = { kind: 'builtin' as const, brand: summary.id };
      const boardProfile = defaultBoardProfileForPalette(projectPalette);
      const serialized = serializeProject({
        name: summary.label,
        createdAt: '2026-08-30T00:00:00.000Z',
        engineVersion: 'catalog-integration-v1',
        boardProfile,
        paletteSelection: { palette: projectPalette, kitTier: 24 },
        params,
        pattern: remapped.pattern,
      }, new Date('2026-08-30T01:00:00.000Z'));
      const parsed = parseProjectFile(serialized);
      expect(parsed.ok, summary.id).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.paletteSelection).toEqual({ palette: projectPalette, kitTier: 24 });
        expect(parsed.value.boardProfile).toBe(boardProfile);
        expect(parsed.value.pattern).toEqual(remapped.pattern);
      }
    }
  });
});
