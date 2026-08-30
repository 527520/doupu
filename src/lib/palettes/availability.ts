import type { PaletteColor } from '@/lib/types';

export interface AvailablePaletteColor extends PaletteColor {
  code: string;
}

/** Normalize a purchasable code and reject upstream placeholder conventions. */
export function normalizeAvailableColorCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  if (code === '' || code === '?' || /^UNKNOWN(?:[-_]|$)/i.test(code)) return null;
  return code;
}

/** Normalize and filter arbitrary palette input before it reaches an engine seam. */
export function availablePaletteColors(colors: readonly PaletteColor[]): AvailablePaletteColor[] {
  const available: AvailablePaletteColor[] = [];
  for (const color of colors) {
    const code = normalizeAvailableColorCode(color.code);
    if (code === null) continue;
    available.push(code === color.code ? color as AvailablePaletteColor : { ...color, code });
  }
  return available;
}

/** Case-insensitive pair identity used at serialized trust boundaries. */
export function paletteColorIdentity(code: string | null, hex: string | null): string | null {
  const normalizedCode = normalizeAvailableColorCode(code);
  if (normalizedCode === null || hex === null || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `${normalizedCode.toUpperCase()}\u0000${hex.toUpperCase()}`;
}
