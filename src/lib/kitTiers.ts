import { getBuiltinPalette } from '@/lib/palettes';
import { availablePaletteColors } from '@/lib/palettes/availability';
import type { AvailablePaletteColor } from '@/lib/palettes/availability';
import type { ProjectPalette } from '@/lib/types';

/** 0 表示使用当前色板的全部可生成颜色。 */
export const KIT_TIERS = [0, 24, 48, 72, 96, 144] as const;
export type KitTier = (typeof KIT_TIERS)[number];

export function isKitTier(value: unknown): value is KitTier {
  return typeof value === 'number' && (KIT_TIERS as readonly number[]).includes(value);
}

export function projectPaletteEngineColors(palette: ProjectPalette): AvailablePaletteColor[] {
  return palette.kind === 'builtin'
    ? availablePaletteColors(getBuiltinPalette(palette.brand).engineColors)
    : availablePaletteColors(palette.colors);
}

export function projectPaletteEngineColorCount(palette: ProjectPalette): number {
  return projectPaletteEngineColors(palette).length;
}

/** 持久化档位必须真的能在当前色板中使用。 */
export function isKitTierAvailableForPalette(value: unknown, palette: ProjectPalette): value is KitTier {
  return isKitTier(value) && (value === 0 || value <= projectPaletteEngineColorCount(palette));
}
