import { paletteColorIdentity } from './availability';
import { getBuiltinPalette } from './index';
import type { Pattern, ProjectPalette } from '@/lib/types';

export interface PatternPaletteMismatch {
  cellIndex: number;
  code: string | null;
  hex: string | null;
}

/**
 * Return the first bead-producing cell absent from the declared palette.
 * Transparent and external/background cells are both non-making references:
 * remapping intentionally preserves their sampled color and statistics omit
 * them, so serialized palette membership does not apply to either kind.
 */
export function firstPatternPaletteMismatch(
  pattern: Pattern,
  palette: ProjectPalette,
): PatternPaletteMismatch | null {
  const colors = palette.kind === 'builtin'
    ? getBuiltinPalette(palette.brand).engineColors
    : palette.colors;
  const declared = new Set(
    colors
      .map((color) => paletteColorIdentity(color.code, color.hex))
      .filter((identity): identity is string => identity !== null),
  );

  for (let cellIndex = 0; cellIndex < pattern.cells.length; cellIndex++) {
    const cell = pattern.cells[cellIndex];
    if (cell.transparent || cell.external) continue;
    const identity = paletteColorIdentity(cell.code, cell.hex);
    if (identity === null || !declared.has(identity)) {
      return { cellIndex, code: cell.code, hex: cell.hex };
    }
  }
  return null;
}
