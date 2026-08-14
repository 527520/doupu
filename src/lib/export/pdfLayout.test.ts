import { describe, expect, it } from 'vitest';
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  PDF_CELL_MM,
  PDF_HEADER_MM,
  PDF_MARGIN_MM,
  PDF_PAGE_COLS,
  PDF_PAGE_ROWS,
  UNTITLED_NAME,
  buildExportFilename,
  computePdfLayout,
  estimateTextWidthPt,
  legendColumns,
  pageHeaderText,
  sanitizeFilenamePart,
  seamPositionsForPage,
  sortStatsForLegend,
  toWinAnsi,
  truncateTextToWidth,
} from './pdfLayout';

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
    });
  });

  it('31×45 恰好一页图纸（整页满格）', () => {
    const layout = computePdfLayout(31, 45);
    expect(layout.gridPages).toHaveLength(1);
    expect(layout.gridPages[0].cols).toBe(31);
    expect(layout.gridPages[0].rows).toBe(45);
    expect(layout.totalPages).toBe(2);
  });

  it('32×45 → 横向 2 页；45×46 → 2×2=4 页', () => {
    expect(computePdfLayout(32, 45).gridPages).toHaveLength(2);
    expect(computePdfLayout(45, 46).gridPages).toHaveLength(4);
  });

  it('200×200 → ceil(200/31)×ceil(200/45)=35 页图纸 + 1 页图例 = 36 页', () => {
    const layout = computePdfLayout(200, 200);
    expect(layout.gridPages).toHaveLength(35);
    expect(layout.totalPages).toBe(36);
    // 最后一页部分页：列 187–200（14 列）、行 181–200（20 行）
    const last = layout.gridPages[34];
    expect(last.colStart).toBe(186);
    expect(last.cols).toBe(14);
    expect(last.rowStart).toBe(180);
    expect(last.rows).toBe(20);
    expect(last.pageIndex).toBe(34);
    expect(last.totalPages).toBe(35);
  });

  it('极宽图（200×2）→ 7 页横向铺开，每页 45 行上限内仅 2 行', () => {
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
    // 70→3 页宽、90→2 页高 = 6 页
    expect(layout.gridPages).toHaveLength(6);
    for (const page of layout.gridPages) {
      expect(page.cols).toBeGreaterThan(0);
      expect(page.rows).toBeGreaterThan(0);
      expect(page.colStart).toBeLessThan(70);
      expect(page.rowStart).toBeLessThan(90);
    }
    // 行优先：第 4 页（index 3）应为第二行的第一列
    expect(layout.gridPages[3].colStart).toBe(0);
    expect(layout.gridPages[3].rowStart).toBe(45);
  });
});

describe('pageHeaderText（行列区间标注）', () => {
  it('1-based 闭区间', () => {
    const layout = computePdfLayout(200, 200);
    expect(pageHeaderText(layout.gridPages[0])).toBe('第 1/35 页 · 列 1–31 · 行 1–45');
    expect(pageHeaderText(layout.gridPages[34])).toBe('第 35/35 页 · 列 187–200 · 行 181–200');
    // 行优先：第 7 页 = 第一行最后一列；第 8 页 = 第二行第一列
    expect(pageHeaderText(layout.gridPages[6])).toBe('第 7/35 页 · 列 187–200 · 行 1–45');
    expect(pageHeaderText(layout.gridPages[7])).toBe('第 8/35 页 · 列 1–31 · 行 46–90');
  });
});

describe('seamPositionsForPage（板缝线）', () => {
  it('只保留落在本页区间内的全局板缝位置', () => {
    const layout = computePdfLayout(200, 200);
    const first = seamPositionsForPage(layout.gridPages[0]);
    expect(first.cols).toEqual([29]);
    expect(first.rows).toEqual([29]);
    const last = seamPositionsForPage(layout.gridPages[34]);
    // 全局 187..200 区间内的 29 倍数：无（174、203 均不在 (186,200) 内）
    expect(last.cols).toEqual([]);
    expect(last.rows).toEqual([]);
  });

  it('小页无板缝', () => {
    const layout = computePdfLayout(10, 10);
    const seams = seamPositionsForPage(layout.gridPages[0]);
    expect(seams.cols).toEqual([]);
    expect(seams.rows).toEqual([]);
  });
});

describe('estimateTextWidthPt / truncateTextToWidth（E26/E27 不溢出）', () => {
  it('CJK 1em、ASCII 0.55em', () => {
    expect(estimateTextWidthPt('测', 10)).toBe(10);
    expect(estimateTextWidthPt('A', 10)).toBeCloseTo(5.5, 6);
    expect(estimateTextWidthPt('A01', 10)).toBeCloseTo(16.5, 6);
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

describe('sanitizeFilenamePart / buildExportFilename（E26）', () => {
  it('非法字符替换、折叠、裁剪首尾', () => {
    expect(sanitizeFilenamePart('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeFilenamePart('__名___字__')).toBe('名_字');
    expect(sanitizeFilenamePart('  ')).toBe('');
  });

  it('空名回退「未命名设计」', () => {
    expect(buildExportFilename('', 100, 200, 'pdf')).toBe(`豆谱-${UNTITLED_NAME}-100x200.pdf`);
    expect(buildExportFilename('   ', 10, 20)).toBe(`豆谱-${UNTITLED_NAME}-10x20.pdf`);
  });

  it('正常名称与超长名称', () => {
    expect(buildExportFilename('我的设计', 50, 60, 'pdf')).toBe('豆谱-我的设计-50x60.pdf');
    const long = buildExportFilename('长'.repeat(200), 20, 30);
    expect(long.endsWith('-20x30.pdf')).toBe(true);
    expect(long.length).toBeLessThan(120);
  });

  it('PNG/PDF 同一规则，仅扩展名不同', () => {
    const png = buildExportFilename('测试', 10, 10, 'png');
    const pdf = buildExportFilename('测试', 10, 10, 'pdf');
    expect(png).toBe('豆谱-测试-10x10.png');
    expect(pdf).toBe('豆谱-测试-10x10.pdf');
  });
});

describe('常量自洽', () => {
  it('页边距+页码区+31×6mm 不超出 A4 宽；45×6mm 不超出 A4 高', () => {
    expect(PDF_MARGIN_MM * 2 + PDF_PAGE_COLS * PDF_CELL_MM).toBeLessThanOrEqual(A4_WIDTH_MM);
    expect(PDF_MARGIN_MM * 2 + PDF_HEADER_MM + PDF_PAGE_ROWS * PDF_CELL_MM).toBeLessThanOrEqual(A4_HEIGHT_MM);
  });
});
