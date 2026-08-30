/**
 * PDF 分页拼图的纯布局计算（spec §F7 PDF 部分；边界 E25/E26/E27）。
 * 与 pdf-lib 解耦：几何分页、页眉文本、文本宽度估算/截断、图例排序、文件名规则都在此层，
 * 全部可单测；pdf.ts 只做绘制与文档组装。
 * 票 02 配置化：分页/尺寸参数经 PdfPageMetrics 传入，默认值来自站点配置（config.ts）。
 */
import { config, normalizePdfMetrics } from '@/lib/config';
import { A4_HEIGHT_MM, A4_WIDTH_MM, MM_TO_PT } from '@/lib/paper';
import { DEFAULT_BOARD_SIZE } from '@/lib/boardProfiles';

export interface PdfPageMetrics {
  cellMm: number;
  marginMm: number;
  headerMm: number;
  pageCols: number;
  pageRows: number;
}

export const defaultPdfMetrics: PdfPageMetrics = {
  cellMm: config.exportPdf.cellMm,
  marginMm: config.exportPdf.marginMm,
  headerMm: config.exportPdf.headerMm,
  pageCols: config.exportPdf.pageCols,
  pageRows: config.exportPdf.pageRows,
};

/**
 * Combine a site-wide PDF configuration with one physical board profile.
 * Validation must happen after overriding cell size and board dimensions:
 * two independently valid configurations can otherwise form an A4-overflowing
 * tuple. The fallback remains profile-aware, especially for 2.6mm output.
 */
export function resolveBoardPdfMetrics(
  configured: PdfPageMetrics,
  boardSize = DEFAULT_BOARD_SIZE,
  cellMm = configured.cellMm,
): PdfPageMetrics {
  const size = Number.isInteger(boardSize) && boardSize > 0
    ? boardSize
    : DEFAULT_BOARD_SIZE;
  const resolvedCellMm = Number.isFinite(cellMm) && cellMm > 0
    ? cellMm
    : defaultPdfMetrics.cellMm;
  const profileFallback = normalizePdfMetrics(
    {
      cellMm: resolvedCellMm,
      marginMm: defaultPdfMetrics.marginMm,
      headerMm: defaultPdfMetrics.headerMm,
      pageCols: size,
      pageRows: size,
    },
    defaultPdfMetrics,
  );
  return normalizePdfMetrics(
    {
      ...configured,
      cellMm: resolvedCellMm,
      pageCols: Math.max(configured.pageCols, size),
      pageRows: Math.max(configured.pageRows, size),
    },
    profileFallback,
  );
}

// 兼容旧引用（测试与外部依赖既有常量名）
export const PDF_CELL_MM = defaultPdfMetrics.cellMm;
export const PDF_PAGE_COLS = defaultPdfMetrics.pageCols;
export const PDF_PAGE_ROWS = defaultPdfMetrics.pageRows;
// 物理自洽（常量自洽测试锁定）：2×8 + 10(页眉) + 45×6 = 296 ≤ 297（A4 高）；2×8 + 31×6 = 202 ≤ 210（A4 宽）
export const PDF_MARGIN_MM = defaultPdfMetrics.marginMm;
export const PDF_HEADER_MM = defaultPdfMetrics.headerMm;
/** 纸张常量统一在 src/lib/paper.ts（J-3：config.ts 曾各自硬编码 210/297）；此处转出保持既有 import 路径。 */
export { A4_WIDTH_MM, A4_HEIGHT_MM, MM_TO_PT };
/** 兼容导出：设计名默认值统一在 export/filename.ts（DEFAULT_DESIGN_NAME）。 */
export { DEFAULT_DESIGN_NAME } from './filename';

export interface PdfPageSpec {
  /** 0-based 图纸页序号 */
  pageIndex: number;
  /** 图纸页总数（不含图例页） */
  totalPages: number;
  colStart: number;
  rowStart: number;
  cols: number;
  rows: number;
  /** 按板分页时的板坐标（1-based，行列均从 1 开始）；自由分页时为 null。 */
  board: { row: number; col: number; rows: number; cols: number } | null;
}

export interface PdfLayout {
  gridPages: PdfPageSpec[];
  /** 图例页为最后一页（0-based） */
  legendPageIndex: number;
  /** 总页数 = 图纸页 + 图例页 */
  totalPages: number;
  /** 按板分页时的板阵列（用于总览页）；自由分页时为 null。 */
  boards: { rows: number; cols: number } | null;
}

/** @deprecated 业务代码应传入当前制作规格；仅保留旧调用方的默认值。 */
export const BOARD_SIZE = DEFAULT_BOARD_SIZE;

/**
 * 分页计算。
 *
 * 两种模式（F-1）：
 * - `byBoard`（默认）：每页正好一块当前制作规格的拼豆板。图纸本来就按板画缝线，
 *   而旧版按 31×45 格切页，页边界与板缝线错位——用户拼的时候要对着一页纸
 *   跨两块板，或者一块板要翻两页。按板分页后「一页 = 一块板」，
 *   还能给出板坐标（第 2 行第 1 列）方便按板归位。
 * - `free`：沿用 metrics.pageCols × pageRows 的自由分页（配置化保留）。
 */
export function computePdfLayout(
  W: number,
  H: number,
  metrics: PdfPageMetrics = defaultPdfMetrics,
  mode: 'byBoard' | 'free' = 'byBoard',
  boardSize = BOARD_SIZE,
): PdfLayout {
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 1 || H < 1) {
    return { gridPages: [], legendPageIndex: 0, totalPages: 1, boards: null };
  }
  const normalizedBoardSize = Number.isInteger(boardSize) && boardSize > 0 ? boardSize : BOARD_SIZE;
  const byBoard = mode === 'byBoard'
    // 一块板必须放得下：版式配置太小时（例如把每页格数调到 20）退回自由分页。
    && metrics.pageCols >= normalizedBoardSize
    && metrics.pageRows >= normalizedBoardSize;
  const pageCols = byBoard ? normalizedBoardSize : metrics.pageCols;
  const pageRows = byBoard ? normalizedBoardSize : metrics.pageRows;
  const pageColsCount = Math.ceil(W / pageCols);
  const pageRowsCount = Math.ceil(H / pageRows);
  const gridPages: PdfPageSpec[] = [];
  for (let pr = 0; pr < pageRowsCount; pr++) {
    for (let pc = 0; pc < pageColsCount; pc++) {
      const colStart = pc * pageCols;
      const rowStart = pr * pageRows;
      gridPages.push({
        pageIndex: gridPages.length,
        totalPages: pageColsCount * pageRowsCount,
        colStart,
        rowStart,
        cols: Math.min(pageCols, W - colStart),
        rows: Math.min(pageRows, H - rowStart),
        board: byBoard
          ? { row: pr + 1, col: pc + 1, rows: pageRowsCount, cols: pageColsCount }
          : null,
      });
    }
  }
  return {
    gridPages,
    legendPageIndex: gridPages.length,
    totalPages: gridPages.length + 1,
    boards: byBoard ? { rows: pageRowsCount, cols: pageColsCount } : null,
  };
}

/** 页眉文本（spec：第 x/y 页、行列区间；坐标为 1-based 闭区间）。 */
export function pageHeaderText(page: PdfPageSpec): string {
  const colEnd = page.colStart + page.cols;
  const rowEnd = page.rowStart + page.rows;
  const position = `列 ${page.colStart + 1}–${colEnd} · 行 ${page.rowStart + 1}–${rowEnd}`;
  if (!page.board) return `第 ${page.pageIndex + 1}/${page.totalPages} 页 · ${position}`;
  // 按板分页时页眉先说「第几板」——拼的时候找的是板，不是页码。
  const boardLabel = page.board.rows * page.board.cols > 1
    ? `第 ${page.board.row} 行 第 ${page.board.col} 列板`
    : '整板';
  return `第 ${page.pageIndex + 1}/${page.totalPages} 页 · ${boardLabel} · ${position}`;
}

/** 全局板缝位置（按当前制作规格，落在当前页区间内才绘制）。 */
export function seamPositionsForPage(page: PdfPageSpec, boardSize = BOARD_SIZE): { cols: number[]; rows: number[] } {
  const cols: number[] = [];
  const rows: number[] = [];
  const size = Number.isInteger(boardSize) && boardSize > 0 ? boardSize : BOARD_SIZE;
  for (let s = size; s < page.colStart + page.cols; s += size) {
    if (s > page.colStart) cols.push(s);
  }
  for (let s = size; s < page.rowStart + page.rows; s += size) {
    if (s > page.rowStart) rows.push(s);
  }
  return { cols, rows };
}

export type PdfTextMeasurer = (text: string, fontSizePt: number) => number;

/**
 * 字体尚未加载时采用保守 1em 上界。布局宁可少排一列，也不能因把
 * `W/M` 当成平均窄字而跨列；真正绘制时 pdf.ts 会注入字体精确测量。
 */
export function estimateTextWidthPt(text: string, fontSizePt: number): number {
  return [...text].length * fontSizePt;
}

/** 超宽文本截断（附加省略号，保证估算宽度 ≤ maxWidthPt；连省略号都放不下时返回 ''）。 */
export function truncateTextToWidth(
  text: string,
  fontSizePt: number,
  maxWidthPt: number,
  ellipsis = '…',
  measure: PdfTextMeasurer = estimateTextWidthPt,
): string {
  if (measure(text, fontSizePt) <= maxWidthPt) return text;
  if (measure(ellipsis, fontSizePt) > maxWidthPt) return '';
  let out = '';
  for (const ch of text) {
    if (measure(out + ch + ellipsis, fontSizePt) > maxWidthPt) break;
    out += ch;
  }
  return out + ellipsis;
}

/** Fit a complete legend label, reserving width for its mandatory quantity suffix. */
export function fitLegendEntryText(
  code: string,
  count: number,
  fontSizePt: number,
  maxWidthPt: number,
  ellipsis = '…',
  measure: PdfTextMeasurer = estimateTextWidthPt,
): string {
  const suffix = ` x${count}`;
  const suffixWidth = measure(suffix, fontSizePt);
  if (suffixWidth > maxWidthPt) {
    return truncateTextToWidth(suffix.trimStart(), fontSizePt, maxWidthPt, ellipsis, measure);
  }
  const fittedCode = truncateTextToWidth(
    code,
    fontSizePt,
    Math.max(0, maxWidthPt - suffixWidth),
    ellipsis,
    measure,
  );
  return `${fittedCode}${suffix}`;
}

/**
 * WinAnsi 安全化：StandardFonts.Helvetica 仅支持 WinAnsi，
 * 中文等字符渲染为垃圾，绘制前统一替换为 '?'（升级路径：嵌入 CJK 字体后移除本层）。
 */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out += code >= 0x20 && code <= 0x7e ? ch : '?';
  }
  return out;
}

/** 图例/清单排序（spec：数量降序；同数量按 hex 升序；不修改入参）。 */
export function sortStatsForLegend<T extends { count: number; hex: string }>(stats: readonly T[]): T[] {
  return [...stats].sort((a, b) => {
    const d = b.count - a.count;
    return d !== 0 ? d : a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0;
  });
}

/** 图例列数：每项 ≥30mm 宽，最多 6 列（保证 291 色单页放得下）。 */
export function legendColumns(usableMm: number): number {
  return Math.min(6, Math.max(1, Math.floor(usableMm / 30)));
}

/** Choose enough column width for every complete `code xcount` label. */
export function legendColumnsForItems<T extends { code: string; count: number }>(
  items: readonly T[],
  usableMm: number,
  fontSizePt = 8,
  measure: PdfTextMeasurer = estimateTextWidthPt,
): number {
  const maximum = legendColumns(usableMm);
  if (items.length === 0) return maximum;
  const usableWidthPt = Math.max(0, usableMm * MM_TO_PT);
  const requiredItemWidthPt = Math.max(
    ...items.map((item) => 16 + measure(`${item.code} x${item.count}`, fontSizePt)),
  );
  return Math.max(1, Math.min(maximum, Math.floor(usableWidthPt / Math.max(1, requiredItemWidthPt))));
}

/**
 * 图例页分页：标题/总计区固定占 53pt，每行 14pt，条目按行填充。
 * 返回的每页条目都能完整落在 A4 页边距内。
 */
export function paginateLegendItems<T extends { code: string; count: number }>(
  items: readonly T[],
  metrics: PdfPageMetrics = defaultPdfMetrics,
  measure: PdfTextMeasurer = estimateTextWidthPt,
): T[][] {
  if (items.length === 0) return [[]];
  const usableWidthMm = Math.max(0, A4_WIDTH_MM - 2 * metrics.marginMm);
  const usableHeightPt = Math.max(0, (A4_HEIGHT_MM - 2 * metrics.marginMm) * MM_TO_PT);
  const rows = Math.max(1, Math.floor((usableHeightPt - 53) / 14));
  const capacity = rows * legendColumnsForItems(items, usableWidthMm, 8, measure);
  const pages: T[][] = [];
  for (let offset = 0; offset < items.length; offset += capacity) {
    pages.push(items.slice(offset, offset + capacity));
  }
  return pages;
}

/**
 * 设计名清洗与导出文件名统一在 export/filename.ts（J-3）。
 * 此前这里用 `_` 且截断 60、layout.ts 用 `-` 且不截断，同一设计名的
 * PNG 与 PDF 会得到不同文件名，而注释却写着「与 PNG 同规则」。
 */
export { buildExportFilename, sanitizeFilename } from './filename';
