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

  it('次要文字与标题不同色，且比标题浅（C-1：此前两者同值，正文层级被压平）', () => {
    expect(token('ink-soft')).not.toBe(token('ink'));
    // 与纯黑的对比度越大＝颜色越浅：ink（最深）→ ink-muted → ink-soft
    expect(contrast(token('ink-soft'), '#000000')).toBeGreaterThan(contrast(token('ink'), '#000000'));
    expect(contrast(token('ink-soft'), token('cream'))).toBeGreaterThanOrEqual(4.5);
  });

  it('状态色在奶油底/白底/软底/丁香底上均满足 4.5:1（C-2：green-600 与 amber-600 只有 3.1）', () => {
    for (const name of ['success', 'warning', 'danger'] as const) {
      expect(contrast(token(name), token('cream'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(name), '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(name), token(`${name}-soft`))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(name), token('lilac-soft'))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('危险色与主粉不同（避免把删除误认成主操作）', () => {
    expect(token('danger')).not.toBe(token('primary'));
  });

  it('提供 notice 组件类的四种语气，并尊重减弱动态效果设置', () => {
    for (const kind of ['info', 'success', 'warning', 'danger']) {
      expect(css).toContain(`.notice-${kind}`);
    }
    expect(css).toContain('prefers-reduced-motion');
  });
});
