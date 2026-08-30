import { describe, expect, it } from 'vitest';
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  MM_TO_PT,
  PDF_CELL_MM,
  PDF_HEADER_MM,
  PDF_MARGIN_MM,
  PDF_PAGE_COLS,
  PDF_PAGE_ROWS,
  DEFAULT_DESIGN_NAME,
  buildExportFilename,
  computePdfLayout,
  defaultPdfMetrics,
  estimateTextWidthPt,
  fitLegendEntryText,
  legendColumns,
  legendColumnsForItems,
  paginateLegendItems,
  pageHeaderText,
  resolveBoardPdfMetrics,
  sanitizeFilename,
  seamPositionsForPage,
  sortStatsForLegend,
  toWinAnsi,
  truncateTextToWidth,
} from './pdfLayout';

describe('resolveBoardPdfMetrics（制作规格整组几何）', () => {
  it('站点配置与 2.6mm 覆盖组合后超出 A4 时，回退仍保持 2.6mm 且一页一块板', () => {
    const configured = {
      cellMm: 2,
      marginMm: 8,
      headerMm: 10,
      pageCols: 80,
      pageRows: 80,
    };

    expect(resolveBoardPdfMetrics(configured, 50, 2.6)).toEqual({
      cellMm: 2.6,
      marginMm: defaultPdfMetrics.marginMm,
      headerMm: defaultPdfMetrics.headerMm,
      pageCols: 50,
      pageRows: 50,
    });
    expect(resolveBoardPdfMetrics(configured, 52, 2.6)).toEqual({
      cellMm: 2.6,
      marginMm: defaultPdfMetrics.marginMm,
      headerMm: defaultPdfMetrics.headerMm,
      pageCols: 52,
      pageRows: 52,
    });
  });
});

describe('computePdfLayout（E25 分页）', () => {
  it('1×1 → 1 页图纸 + 1 页图例 = 2 页', () => {
    const layout = computePdfLayout(1, 1);
    expect(layout.gridPages).toHaveLength(1);
    expect(layout.totalPages).toBe(2);
    expect(layout.legendPageIndex).toBe(1);
    expect(layout.gridPages[0]).toEqual({
      pageIndex: 0,
      totalPages: 1,
      colStart: 0,
      rowStart: 0,
      cols: 1,
      rows: 1,
      board: { row: 1, col: 1, rows: 1, cols: 1 },
    });
  });

  it('默认按板分页：一页正好一块 29×29 板（F-1）', () => {
    const layout = computePdfLayout(29, 29);
    expect(layout.gridPages).toHaveLength(1);
    expect(layout.gridPages[0].cols).toBe(29);
    expect(layout.gridPages[0].rows).toBe(29);
    expect(layout.boards).toEqual({ rows: 1, cols: 1 });

    // 30 格宽 → 第二块板只有 1 列，仍单独成页（与板缝线对齐）
    const wide = computePdfLayout(30, 29);
    expect(wide.gridPages).toHaveLength(2);
    expect(wide.gridPages[1].colStart).toBe(29);
    expect(wide.gridPages[1].cols).toBe(1);
    expect(wide.gridPages[1].board).toEqual({ row: 1, col: 2, rows: 1, cols: 2 });
  });

  it('2.6mm 规格按 50×50 或 52×52 独立分页', () => {
    const mini50 = computePdfLayout(
      101,
      52,
      { ...defaultPdfMetrics, cellMm: 2.6, pageCols: 50, pageRows: 50 },
      'byBoard',
      50,
    );
    expect(mini50.gridPages).toHaveLength(6);
    expect(mini50.boards).toEqual({ rows: 2, cols: 3 });
    expect(mini50.gridPages[1]).toMatchObject({ colStart: 50, cols: 50, rowStart: 0, rows: 50 });
    expect(mini50.gridPages[5]).toMatchObject({ colStart: 100, cols: 1, rowStart: 50, rows: 2 });

    const mini52 = computePdfLayout(
      53,
      52,
      { ...defaultPdfMetrics, cellMm: 2.6, pageCols: 52, pageRows: 52 },
      'byBoard',
      52,
    );
    expect(mini52.gridPages).toHaveLength(2);
    expect(mini52.gridPages[1]).toMatchObject({ colStart: 52, cols: 1, rows: 52 });
  });

  it('free 模式沿用配置化的每页格数（31×45）', () => {
    const layout = computePdfLayout(31, 45, defaultPdfMetrics, 'free');
    expect(layout.gridPages).toHaveLength(1);
    expect(layout.gridPages[0].cols).toBe(31);
    expect(layout.gridPages[0].rows).toBe(45);
    expect(layout.gridPages[0].board).toBeNull();
    expect(layout.boards).toBeNull();
    expect(computePdfLayout(32, 45, defaultPdfMetrics, 'free').gridPages).toHaveLength(2);
    expect(computePdfLayout(45, 46, defaultPdfMetrics, 'free').gridPages).toHaveLength(4);
  });

  it('每页格数配置不足一块板时退回自由分页（不能把板切开）', () => {
    const small = { ...defaultPdfMetrics, pageCols: 20, pageRows: 20 };
    const layout = computePdfLayout(40, 40, small);
    expect(layout.boards).toBeNull();
    expect(layout.gridPages).toHaveLength(4);
    expect(layout.gridPages[0].cols).toBe(20);
  });

  it('200×200 → 按板 7×7=49 页图纸 + 1 页图例 = 50 页', () => {
    const layout = computePdfLayout(200, 200);
    expect(layout.gridPages).toHaveLength(49);
    expect(layout.totalPages).toBe(50);
    expect(layout.boards).toEqual({ rows: 7, cols: 7 });
    // 最后一页部分板：列 175–200（26 列）、行 175–200（26 行）
    const last = layout.gridPages[48];
    expect(last.colStart).toBe(174);
    expect(last.cols).toBe(26);
    expect(last.rowStart).toBe(174);
    expect(last.rows).toBe(26);
    expect(last.board).toEqual({ row: 7, col: 7, rows: 7, cols: 7 });
  });

  it('极宽图（200×2）→ 7 页横向铺开，每页仅 2 行', () => {
    const layout = computePdfLayout(200, 2);
    expect(layout.gridPages).toHaveLength(7);
    expect(layout.gridPages.every((p) => p.rows === 2)).toBe(true);
  });

  it('非法尺寸回退为空图纸页 + 1 页图例', () => {
    for (const [w, h] of [
      [0, 10],
      [10, 0],
      [-1, 10],
      [1.5, 10],
      [NaN, 10],
    ] as Array<[number, number]>) {
      const layout = computePdfLayout(w, h);
      expect(layout.gridPages, `${w}×${h}`).toHaveLength(0);
      expect(layout.totalPages).toBe(1);
    }
  });

  it('图纸页按行优先排列，坐标连续且不重叠', () => {
    const layout = computePdfLayout(70, 90);
    // 70→3 块板宽、90→4 块板高 = 12 页
    expect(layout.gridPages).toHaveLength(12);
    for (const page of layout.gridPages) {
      expect(page.cols).toBeGreaterThan(0);
      expect(page.rows).toBeGreaterThan(0);
      expect(page.colStart).toBeLessThan(70);
      expect(page.rowStart).toBeLessThan(90);
    }
    // 行优先：第 4 页（index 3）应为第二行的第一列
    expect(layout.gridPages[3].colStart).toBe(0);
    expect(layout.gridPages[3].rowStart).toBe(29);
  });
});

describe('pageHeaderText（行列区间标注）', () => {
  it('按板分页：先说第几板，再说行列区间（F-1）', () => {
    const layout = computePdfLayout(200, 200); // 7×7 板
    expect(pageHeaderText(layout.gridPages[0])).toBe('第 1/49 页 · 第 1 行 第 1 列板 · 列 1–29 · 行 1–29');
    expect(pageHeaderText(layout.gridPages[48])).toBe('第 49/49 页 · 第 7 行 第 7 列板 · 列 175–200 · 行 175–200');
    // 行优先：第 7 页 = 第一行最后一列板；第 8 页 = 第二行第一列板
    expect(pageHeaderText(layout.gridPages[6])).toBe('第 7/49 页 · 第 1 行 第 7 列板 · 列 175–200 · 行 1–29');
    expect(pageHeaderText(layout.gridPages[7])).toBe('第 8/49 页 · 第 2 行 第 1 列板 · 列 1–29 · 行 30–58');
  });

  it('只有一块板时不啰嗦板坐标', () => {
    const layout = computePdfLayout(29, 29);
    expect(pageHeaderText(layout.gridPages[0])).toBe('第 1/1 页 · 整板 · 列 1–29 · 行 1–29');
  });

  it('free 模式保持原样（1-based 闭区间）', () => {
    const layout = computePdfLayout(200, 200, defaultPdfMetrics, 'free');
    expect(pageHeaderText(layout.gridPages[0])).toBe('第 1/35 页 · 列 1–31 · 行 1–45');
    expect(pageHeaderText(layout.gridPages[34])).toBe('第 35/35 页 · 列 187–200 · 行 181–200');
  });
});

describe('seamPositionsForPage（板缝线）', () => {
  it('按板分页后页内不再有板缝线——页边界就是板缝（F-1）', () => {
    const layout = computePdfLayout(200, 200);
    const first = seamPositionsForPage(layout.gridPages[0]);
    expect(first.cols).toEqual([]);
    expect(first.rows).toEqual([]);
  });

  it('free 模式下只保留落在本页区间内的全局板缝位置', () => {
    const layout = computePdfLayout(200, 200, defaultPdfMetrics, 'free');
    const first = seamPositionsForPage(layout.gridPages[0]);
    expect(first.cols).toEqual([29]);
    expect(first.rows).toEqual([29]);
    const last = seamPositionsForPage(layout.gridPages[34]);
    // 全局 187..200 区间内的 29 倍数：无（174、203 均不在 (186,200) 内）
    expect(last.cols).toEqual([]);
    expect(last.rows).toEqual([]);
  });

  it('free 模式按选择的 50×50 板定位全局板缝', () => {
    const metrics = { ...defaultPdfMetrics, pageCols: 60, pageRows: 60 };
    const layout = computePdfLayout(120, 120, metrics, 'free', 50);
    expect(seamPositionsForPage(layout.gridPages[0], 50)).toEqual({ cols: [50], rows: [50] });
    expect(seamPositionsForPage(layout.gridPages[3], 50)).toEqual({ cols: [100], rows: [100] });
  });

  it('小页无板缝', () => {
    const layout = computePdfLayout(10, 10);
    const seams = seamPositionsForPage(layout.gridPages[0]);
    expect(seams.cols).toEqual([]);
    expect(seams.rows).toEqual([]);
  });
});

describe('estimateTextWidthPt / truncateTextToWidth（E26/E27 不溢出）', () => {
  it('字体未加载时对 CJK 与宽 ASCII 都采用保守 1em', () => {
    expect(estimateTextWidthPt('测', 10)).toBe(10);
    expect(estimateTextWidthPt('A', 10)).toBe(10);
    expect(estimateTextWidthPt('WWW', 10)).toBe(30);
  });

  it('未超宽原样返回；超宽截断并加省略号；极窄返回空串', () => {
    const long = 'A'.repeat(100);
    expect(truncateTextToWidth('ABC', 10, 100)).toBe('ABC');
    const cut = truncateTextToWidth(long, 10, 60);
    expect(estimateTextWidthPt(cut, 10)).toBeLessThanOrEqual(60);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThan(100);
    expect(truncateTextToWidth('ABC', 10, 1)).toBe('');
  });

  it('100 字设计名与 20 字超长色号均被截断到给定宽度内', () => {
    const name = '豆'.repeat(100);
    const cutName = truncateTextToWidth(name, 12, 400);
    expect(estimateTextWidthPt(cutName, 12)).toBeLessThanOrEqual(400);
    expect(cutName).not.toBe(name);
    const code = 'X'.repeat(20);
    const cutCode = truncateTextToWidth(code, 4, 15);
    expect(estimateTextWidthPt(cutCode, 4)).toBeLessThanOrEqual(15);
  });
});

describe('toWinAnsi', () => {
  it('ASCII 保留，其余替换为 ?', () => {
    expect(toWinAnsi('A01 ×12')).toBe('A01 ?12');
    expect(toWinAnsi('第 1/2 页')).toBe('? 1/2 ?');
    expect(toWinAnsi('abc123')).toBe('abc123');
  });
});

describe('sortStatsForLegend（清单排序）', () => {
  const stats = [
    { code: 'A', hex: '#000000', count: 1 },
    { code: 'B', hex: '#FFFFFF', count: 3 },
    { code: 'C', hex: '#010101', count: 3 },
  ];

  it('数量降序、同数量 hex 升序、不修改入参', () => {
    const input = [...stats];
    const sorted = sortStatsForLegend(stats);
    // B/C 同数量 → hex 升序：#010101(C) < #FFFFFF(B)
    expect(sorted.map((s) => s.code)).toEqual(['C', 'B', 'A']);
    expect(stats).toEqual(input);
  });
});

describe('legendColumns', () => {
  it('可用 190mm → 6 列；钳制上下界', () => {
    expect(legendColumns(190)).toBe(6);
    expect(legendColumns(29)).toBe(1);
    expect(legendColumns(500)).toBe(6);
    expect(legendColumns(0)).toBe(1);
  });
});

describe('paginateLegendItems', () => {
  it('500 色图例分页且每个条目恰好出现一次', () => {
    const items = Array.from({ length: 500 }, (_, index) => ({ code: `C${index}`, count: 1 }));
    const pages = paginateLegendItems(items);
    expect(pages.map((page) => page.length)).toEqual([318, 182]);
    expect(pages.flat()).toEqual(items);
    expect(pages.every((page) => page.length > 0)).toBe(true);
  });

  it('500 色中的 20 字符色号会为四位数量后缀预留列宽', () => {
    const usableMm = A4_WIDTH_MM - 2 * defaultPdfMetrics.marginMm;
    const items = Array.from({ length: 500 }, (_, index) => ({
      code: index === 0 ? 'ABCDEFGHIJKLMNOPQRST' : `C${index}`,
      count: index === 0 ? 1000 : 1,
    }));

    const columns = legendColumnsForItems(items, usableMm);
    const dynamicTextWidthPt = (usableMm * MM_TO_PT) / columns - 16;
    const rendered = paginateLegendItems(items).flat().map((item) =>
      fitLegendEntryText(item.code, item.count, 8, dynamicTextWidthPt, '...'));

    expect(rendered).toHaveLength(500);
    expect(rendered[0]).toBe('ABCDEFGHIJKLMNOPQRST x1000');
    expect(new Set(rendered.map((text) => text.split(' x')[0])).size).toBe(500);
    expect(rendered.every((text) => estimateTextWidthPt(text, 8) <= dynamicTextWidthPt)).toBe(true);

    const marginPt = defaultPdfMetrics.marginMm * MM_TO_PT;
    const pageWidthPt = A4_WIDTH_MM * MM_TO_PT;
    const pageHeightPt = A4_HEIGHT_MM * MM_TO_PT;
    const itemWidthPt = (usableMm * MM_TO_PT) / columns;
    for (const page of paginateLegendItems(items)) {
      page.forEach((item, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = marginPt + column * itemWidthPt;
        const y = pageHeightPt - marginPt - 46 - row * 14;
        const label = `${item.code} x${item.count}`;
        expect(x).toBeGreaterThanOrEqual(marginPt);
        expect(x + 12 + estimateTextWidthPt(label, 8)).toBeLessThanOrEqual(pageWidthPt - marginPt);
        expect(y - 8).toBeGreaterThanOrEqual(marginPt);
      });
    }
  });
});

describe('buildExportFilename（E26；规则统一在 export/filename.ts，J-3）', () => {
  it('非法字符替换为 -、折叠、裁剪首尾（与 PNG 同一套规则）', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(sanitizeFilename('--名---字--')).toBe('名-字');
    expect(sanitizeFilename('  ')).toBe(DEFAULT_DESIGN_NAME);
  });

  it('空名回退「未命名设计」', () => {
    expect(buildExportFilename('', 100, 200, 'pdf')).toBe(`豆谱-${DEFAULT_DESIGN_NAME}-100x200.pdf`);
    expect(buildExportFilename('   ', 10, 20)).toBe(`豆谱-${DEFAULT_DESIGN_NAME}-10x20.pdf`);
  });

  it('正常名称与超长名称', () => {
    expect(buildExportFilename('我的设计', 50, 60, 'pdf')).toBe('豆谱-我的设计-50x60.pdf');
    const long = buildExportFilename('长'.repeat(200), 20, 30);
    expect(long.endsWith('-20x30.pdf')).toBe(true);
    expect(long.length).toBeLessThan(120);
  });

  it('PNG 与 PDF 的文件名只差扩展名（此前 - 与 _ 两套规则会给出不同名字）', () => {
    const png = buildExportFilename('测试:图纸', 10, 10, 'png');
    const pdf = buildExportFilename('测试:图纸', 10, 10, 'pdf');
    expect(png).toBe('豆谱-测试-图纸-10x10.png');
    expect(pdf).toBe('豆谱-测试-图纸-10x10.pdf');
    expect(png.replace(/\.png$/, '')).toBe(pdf.replace(/\.pdf$/, ''));
  });
});

describe('常量自洽', () => {
  it('页边距+页码区+31×6mm 不超出 A4 宽；45×6mm 不超出 A4 高', () => {
    expect(PDF_MARGIN_MM * 2 + PDF_PAGE_COLS * PDF_CELL_MM).toBeLessThanOrEqual(A4_WIDTH_MM);
    expect(PDF_MARGIN_MM * 2 + PDF_HEADER_MM + PDF_PAGE_ROWS * PDF_CELL_MM).toBeLessThanOrEqual(A4_HEIGHT_MM);
  });
});
