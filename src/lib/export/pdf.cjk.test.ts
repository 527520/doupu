import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { generatePatternPdf } from './pdf';
import type { Pattern, PatternStatsItem } from '@/lib/types';

const fontBytes = new Uint8Array(
  readFileSync(resolve(process.cwd(), 'public/fonts/NotoSansCJKsc-Regular.otf')),
);

const pattern: Pattern = {
  width: 2,
  height: 2,
  cells: [
    { hex: '#FF0000', code: 'F02', transparent: false },
    { hex: '#00FF00', code: 'B04', transparent: false },
    { hex: '#0000FF', code: 'C07', transparent: false },
    { hex: '#FFFFFF', code: 'T01', transparent: false },
  ],
};

const stats: PatternStatsItem[] = [
  { code: 'F02', hex: '#FF0000', count: 1 },
  { code: 'B04', hex: '#00FF00', count: 1 },
  { code: 'C07', hex: '#0000FF', count: 1 },
  { code: 'T01', hex: '#FFFFFF', count: 1 },
];

/** 解压 PDF 中全部 FlateDecode 流并拼接（字体字典可能位于压缩 ObjStm 中）。 */
function decompressedText(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes).toString('latin1');
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin)) !== null) {
    try {
      parts.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
    } catch {
      // 非 Flate 流（如字体二进制）无法解压，忽略
    }
  }
  return parts.join('');
}

describe('generatePatternPdf（CJK 字体嵌入）', () => {
  it(
    '嵌入 Noto Sans SC 子集：中文页眉/图例不抛错，PDF 含嵌入字体',
    async () => {
      const bytes = await generatePatternPdf(
        { name: '测试设计·拼豆', pattern, stats },
        { fontBytes },
      );
      expect(decompressedText(bytes)).toContain('NotoSansCJKsc');
      expect(bytes.length).toBeGreaterThan(3000); // 字体子集显著增大体积
    },
    60000,
  );

  it(
    '无字体时降级 Helvetica（中文替换为 ?），仍产出合法 PDF',
    async () => {
      const bytes = await generatePatternPdf({ name: '测试设计', pattern, stats });
      expect(decompressedText(bytes)).toContain('Helvetica');
    },
    30000,
  );

  it('字体字节为空数组时同样走降级路径', async () => {
    const bytes = await generatePatternPdf(
      { name: 'x', pattern, stats },
      { fontBytes: new Uint8Array(0) },
    );
    expect(bytes[0]).toBe(0x25);
  }, 30000);
});
