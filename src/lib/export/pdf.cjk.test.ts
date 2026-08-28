import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { generatePatternPdf } from './pdf';
import { A4_HEIGHT_MM, A4_WIDTH_MM, MM_TO_PT, defaultPdfMetrics, paginateLegendItems } from './pdfLayout';
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

function drawnAsciiText(bytes: Uint8Array): string[] {
  const commands = decompressedText(bytes);
  return [...commands.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((match) =>
    Buffer.from(match[1], 'hex').toString('latin1'));
}

function drawnAsciiPlacements(bytes: Uint8Array): Array<{ text: string; size: number; x: number; y: number }> {
  const commands = decompressedText(bytes);
  return [...commands.matchAll(/\/\S+\s+([\d.]+)\s+Tf[\s\S]*?1 0 0 1 ([\d.]+) ([\d.]+) Tm\s*<([0-9A-Fa-f]+)>\s*Tj/g)]
    .map((match) => ({
      size: Number(match[1]),
      x: Number(match[2]),
      y: Number(match[3]),
      text: Buffer.from(match[4], 'hex').toString('latin1'),
    }));
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

  it('500 色用量清单会增加图例页，不在单页外裁切', async () => {
    const manyStats = Array.from({ length: 500 }, (_, index) => ({
      code: index === 0 ? 'ABCDEFGHIJKLMNOPQRST' : `C${index}`,
      hex: `#${index.toString(16).padStart(6, '0')}`,
      count: index === 0 ? 1000 : 1,
    }));
    const manyPattern: Pattern = {
      width: 25,
      height: 20,
      cells: manyStats.map((item) => ({ hex: item.hex, code: item.code, transparent: false })),
    };
    const bytes = await generatePatternPdf({ name: '500 colors', pattern: manyPattern, stats: manyStats });
    const document = await PDFDocument.load(bytes);
    const measureDocument = await PDFDocument.create();
    const helvetica = await measureDocument.embedFont(StandardFonts.Helvetica);
    const measure = (text: string, size: number): number => helvetica.widthOfTextAtSize(text, size);
    expect(document.getPageCount()).toBe(1 + paginateLegendItems(manyStats, defaultPdfMetrics, measure).length);
    const text = new Set(drawnAsciiText(bytes));
    for (const item of manyStats) expect(text.has(`${item.code} x${item.count}`)).toBe(true);
  }, 30000);

  it('从 PDF 绘制指令校验宽字形色号与长标题均处于 A4 可见边界', async () => {
    const manyStats = Array.from({ length: 500 }, (_, index) => ({
      code: `${'W'.repeat(17)}${String(index).padStart(3, '0')}`,
      hex: `#${index.toString(16).padStart(6, '0')}`,
      count: index === 0 ? 1000 : 1,
    }));
    const manyPattern: Pattern = {
      width: 25,
      height: 20,
      cells: manyStats.map((item) => ({ hex: item.hex, code: item.code, transparent: false })),
    };
    const bytes = await generatePatternPdf({ name: 'W'.repeat(100), pattern: manyPattern, stats: manyStats });
    const placements = drawnAsciiPlacements(bytes);
    const measureDocument = await PDFDocument.create();
    const helvetica = await measureDocument.embedFont(StandardFonts.Helvetica);
    const marginPt = defaultPdfMetrics.marginMm * MM_TO_PT;
    const right = A4_WIDTH_MM * MM_TO_PT - marginPt;
    const top = A4_HEIGHT_MM * MM_TO_PT - marginPt;

    for (const item of manyStats) {
      const label = `${item.code} x${item.count}`;
      const placement = placements.find((candidate) => candidate.text === label);
      expect(placement, label).toBeDefined();
      expect(placement!.x + helvetica.widthOfTextAtSize(label, placement!.size)).toBeLessThanOrEqual(right + 0.01);
      expect(placement!.y).toBeGreaterThanOrEqual(marginPt);
    }
    const titles = placements.filter((placement) => placement.size === 12 && placement.text.startsWith('Legend'));
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(title.x + helvetica.widthOfTextAtSize(title.text, title.size)).toBeLessThanOrEqual(right + 0.01);
      expect(title.y).toBeLessThanOrEqual(top);
    }
  }, 30000);

  it('Noto 真实宽度驱动 500 色图例列数，产物 Tm 坐标不跨列或页边界', async () => {
    const manyStats = Array.from({ length: 500 }, (_, index) => ({
      code: `${'W'.repeat(17)}${String(index).padStart(3, '0')}`,
      hex: `#${index.toString(16).padStart(6, '0')}`,
      count: index === 0 ? 1000 : 1,
    }));
    const manyPattern: Pattern = {
      width: 25,
      height: 20,
      cells: manyStats.map((item) => ({ hex: item.hex, code: item.code, transparent: false })),
    };
    const bytes = await generatePatternPdf({ name: 'Noto wide glyphs', pattern: manyPattern, stats: manyStats }, { fontBytes });
    const placements = drawnAsciiPlacements(bytes).filter((placement) => placement.size === 8);
    const measureDocument = await PDFDocument.create();
    measureDocument.registerFontkit(fontkit);
    const noto = await measureDocument.embedFont(fontBytes, { subset: true });
    const marginPt = defaultPdfMetrics.marginMm * MM_TO_PT;
    const right = A4_WIDTH_MM * MM_TO_PT - marginPt;

    expect(placements).toHaveLength(manyStats.length);
    placements.forEach((placement, index) => {
      const item = manyStats[index];
      const label = `${item.code} x${item.count}`;
      expect(placement.x + noto.widthOfTextAtSize(label, 8)).toBeLessThanOrEqual(right + 0.01);
      expect(placement.y).toBeGreaterThanOrEqual(marginPt);
    });
  }, 30000);

  it('直接调用传入超出 A4 的整组 metrics 也会回退安全默认值', async () => {
    const widePattern: Pattern = {
      width: 32,
      height: 1,
      cells: Array.from({ length: 32 }, () => ({ hex: '#000000', code: 'A', transparent: false })),
    };
    const bytes = await generatePatternPdf(
      { name: 'metrics', pattern: widePattern, stats: [{ code: 'A', hex: '#000000', count: 32 }] },
      { metrics: { cellMm: 20, marginMm: 30, headerMm: 30, pageCols: 100, pageRows: 100 } },
    );
    const document = await PDFDocument.load(bytes);
    // 回退后按板分页：32 列 = 2 块板 → 板位总览 1 页 + 图纸 2 页 + 图例 1 页（F-1）
    expect(document.getPageCount()).toBe(4);
  }, 30000);

  it('多块板时首页是板位总览（F-1）', async () => {
    // 60×29 = 横向 3 块板（29+29+2）
    const wide: Pattern = {
      width: 60,
      height: 29,
      cells: Array.from({ length: 60 * 29 }, () => ({ hex: '#000000', code: 'A', transparent: false })),
    };
    const bytes = await generatePatternPdf(
      { name: '板位', pattern: wide, stats: [{ code: 'A', hex: '#000000', count: 60 * 29 }] },
      { fontBytes },
    );
    const document = await PDFDocument.load(bytes);
    // 总览 1 + 图纸 3（一页一块板）+ 图例 1
    expect(document.getPageCount()).toBe(5);
  }, 30000);

  it('板位总览页在 ASCII 降级路径下也有可读标题', async () => {
    const wide: Pattern = {
      width: 60,
      height: 29,
      cells: Array.from({ length: 60 * 29 }, () => ({ hex: '#000000', code: 'A', transparent: false })),
    };
    // 不传 fontBytes → 走 Helvetica/ASCII 降级，可直接读出绘制文本
    const bytes = await generatePatternPdf(
      { name: 'board map', pattern: wide, stats: [{ code: 'A', hex: '#000000', count: 60 * 29 }] },
    );
    const texts = drawnAsciiText(bytes).join(' ');
    expect(texts).toContain('Board map');
    expect(texts).toContain('3 boards');
  }, 30000);

  it('单块板不出总览页（不为一页纸多印一张说明）', async () => {
    const single: Pattern = {
      width: 10,
      height: 10,
      cells: Array.from({ length: 100 }, () => ({ hex: '#000000', code: 'A', transparent: false })),
    };
    const bytes = await generatePatternPdf(
      { name: '单板', pattern: single, stats: [{ code: 'A', hex: '#000000', count: 100 }] },
      { fontBytes },
    );
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(2); // 图纸 1 + 图例 1
  }, 30000);
});
