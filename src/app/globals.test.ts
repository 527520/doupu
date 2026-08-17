import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

function token(name: string): string {
  const value = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`missing color token: ${name}`);
  return value;
}

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = hex.match(/[0-9a-f]{2}/gi)?.map((part) => Number.parseInt(part, 16) / 255) ?? [];
    const [r, g, b] = channels.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('全局颜色 token', () => {
  it('正常文字与主按钮满足 WCAG AA 4.5:1，控件描边满足 3:1', () => {
    expect(contrast(token('primary'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('primary-deep'), token('primary-soft'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('ink-soft'), token('lilac-soft'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('lilac'), '#ffffff')).toBeGreaterThanOrEqual(3);
  });
});
