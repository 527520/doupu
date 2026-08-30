/**
 * 打印版 PDF 生成（spec §F7 PDF 部分）。
 * 依赖 pdf-lib；布局计算全部委托 pdfLayout.ts。
 * 文本：传入 CJK 字体字节（Noto Sans SC，OFL）时嵌入子集并输出中文；
 * 未传入时回退 Helvetica + WinAnsi（非 ASCII 替换为 '?'，仅用于测试/降级路径）。
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { totalBeadCount } from '@/lib/engine/generate';
import { hexToRgb } from '@/lib/engine/color';
import { contrastColor } from '@/lib/render/layout';
import { zhCN } from '@/messages/zh-CN';
import type { Pattern, PatternStatsItem } from '@/lib/types';
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  MM_TO_PT,
  computePdfLayout,
  defaultPdfMetrics,
  fitLegendEntryText,
  legendColumnsForItems,
  pageHeaderText,
  paginateLegendItems,
  resolveBoardPdfMetrics,
  seamPositionsForPage,
  sortStatsForLegend,
  toWinAnsi,
  truncateTextToWidth,
  type PdfPageMetrics,
  type PdfTextMeasurer,
} from './pdfLayout';

export interface PdfExportInput {
  name: string;
  pattern: Pattern;
  /** 用量统计（来自 computeStats，本函数会再按降序排序） */
  stats: PatternStatsItem[];
}

export interface PdfExportOptions {
  /** Noto Sans SC 字体字节；null/undefined 时走 ASCII 降级路径 */
  fontBytes?: Uint8Array | null;
  /** 版式参数（票 02 配置化）；缺省用站点配置默认值 */
  metrics?: PdfPageMetrics;
  /** 当前制作规格的一块板边长；缺省保持兼容规格。 */
  boardSize?: number;
}

const PAGE_W_PT = A4_WIDTH_MM * MM_TO_PT;
const PAGE_H_PT = A4_HEIGHT_MM * MM_TO_PT;

function drawLegend(
  page: PDFPage,
  font: PDFFont,
  name: string,
  stats: PatternStatsItem[],
  cjk: boolean,
  metrics: PdfPageMetrics,
  totalCount: number,
  pageNumber: number,
  pageCount: number,
  columnCount: number,
  measure: PdfTextMeasurer,
): void {
  const t = zhCN.export;
  const marginPt = metrics.marginMm * MM_TO_PT;
  const top = PAGE_H_PT - marginPt;
  const pageSuffix = pageCount > 1 ? ` (${pageNumber}/${pageCount})` : '';
  const rawTitle = cjk ? `${t.legendTitle} · ${name.trim()}${pageSuffix}` : `Legend · ${name.trim()}${pageSuffix}`;
  const title = truncateTextToWidth(rawTitle || 'Pattern', 12, PAGE_W_PT - 2 * marginPt, '...', measure);
  page.drawText(cjk ? title : toWinAnsi(title), { x: marginPt, y: top - 14, size: 12, font });

  const items = sortStatsForLegend(stats);
  const totalText = cjk ? `总计：${totalCount} ${t.countUnit}` : `Total: ${totalCount} beads`;
  page.drawText(totalText, { x: marginPt, y: top - 28, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
  if (items.length === 0) return;

  const usableMm = A4_WIDTH_MM - 2 * metrics.marginMm;
  const cols = columnCount;
  const itemW = (usableMm * MM_TO_PT) / cols;
  const rowH = 14;
  const listTop = top - 46;
  const maxTextWidth = itemW - 16;

  items.forEach((item, index) => {
    const c = index % cols;
    const r = Math.floor(index / cols);
    const x = marginPt + c * itemW;
    const y = listTop - r * rowH;
    const parsed = hexToRgb(item.hex);
    if (parsed) {
      page.drawRectangle({
        x,
        y: y - 8,
        width: 8,
        height: 8,
        color: rgb(parsed.r / 255, parsed.g / 255, parsed.b / 255),
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.4,
      });
    }
    const text = fitLegendEntryText(item.code, item.count, 8, maxTextWidth, '...', measure);
    page.drawText(cjk ? text : toWinAnsi(text), { x: x + 12, y: y - 7, size: 8, font });
  });
}

/**
 * 板位总览页（F-1）：图纸被切成多块板时，先给一页「这些板怎么拼在一起」。
 * 没有这一页，用户拿到 49 张纸只能靠页眉的行列区间在脑子里拼装。
 */
function drawBoardOverviewPage(
  page: PDFPage,
  boards: { rows: number; cols: number },
  patternWidth: number,
  patternHeight: number,
  name: string,
  font: PDFFont,
  cjk: boolean,
  metrics: PdfPageMetrics,
  measure: PdfTextMeasurer,
): void {
  const t = zhCN.exportPdf;
  const marginPt = metrics.marginMm * MM_TO_PT;
  const top = PAGE_H_PT - marginPt;
  const rawTitle = cjk ? `${t.boardOverviewTitle} · ${name.trim()}` : `Board map · ${name.trim()}`;
  const title = truncateTextToWidth(rawTitle, 14, PAGE_W_PT - 2 * marginPt, '...', measure);
  page.drawText(cjk ? title : toWinAnsi(title), { x: marginPt, y: top - 16, size: 14, font });

  const summary = cjk
    ? t.boardOverviewSummary(boards.rows * boards.cols, boards.cols, boards.rows, patternWidth, patternHeight)
    : `${boards.rows * boards.cols} boards (${boards.cols} x ${boards.rows}), ${patternWidth} x ${patternHeight} cells`;
  page.drawText(cjk ? summary : toWinAnsi(summary), {
    x: marginPt,
    y: top - 32,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  // 板位示意图：按板阵列画格子，格内标「行-列」，与各页页眉的板坐标一致。
  const usableW = PAGE_W_PT - 2 * marginPt;
  const usableH = top - 60 - marginPt;
  const cell = Math.max(24, Math.min(usableW / boards.cols, usableH / boards.rows, 90));
  const mapW = cell * boards.cols;
  const mapTop = top - 52;
  for (let row = 0; row < boards.rows; row++) {
    for (let col = 0; col < boards.cols; col++) {
      const x = marginPt + (usableW - mapW) / 2 + col * cell;
      const y = mapTop - (row + 1) * cell;
      page.drawRectangle({
        x,
        y,
        width: cell,
        height: cell,
        borderColor: rgb(0.45, 0.4, 0.5),
        borderWidth: 0.8,
      });
      const label = `${row + 1}-${col + 1}`;
      const size = Math.min(10, cell / 3);
      const textWidth = font.widthOfTextAtSize(label, size);
      page.drawText(label, {
        x: x + (cell - textWidth) / 2,
        y: y + (cell - size) / 2,
        size,
        font,
        color: rgb(0.3, 0.27, 0.35),
      });
    }
  }
}

/** 生成分页拼图 PDF；返回 PDF 字节。 */
export async function generatePatternPdf(
  input: PdfExportInput,
  options: PdfExportOptions = {},
): Promise<Uint8Array> {
  const { name, pattern, stats } = input;
  const { width: W, height: H, cells } = pattern;
  const requestedMetrics = options.metrics ?? defaultPdfMetrics;
  const metrics = resolveBoardPdfMetrics(
    requestedMetrics,
    options.boardSize,
    requestedMetrics.cellMm,
  );
  const marginPt = metrics.marginMm * MM_TO_PT;
  const headerPt = metrics.headerMm * MM_TO_PT;
  const cellPt = metrics.cellMm * MM_TO_PT;
  const layout = computePdfLayout(W, H, metrics, 'byBoard', options.boardSize);
  if (layout.gridPages.length === 0) {
    throw new Error(`empty pattern (${W}×${H})`);
  }

  const doc = await PDFDocument.create();
  doc.setTitle(name.trim() || '豆谱图纸');

  let font: PDFFont;
  let cjk = false;
  if (options.fontBytes && options.fontBytes.length > 0) {
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(options.fontBytes, { subset: true });
    cjk = true;
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica);
  }
  const measure: PdfTextMeasurer = (text, size) => font.widthOfTextAtSize(cjk ? text : toWinAnsi(text), size);

  // 多块板时先出一页板位总览（F-1）：一页 = 一块板之后，用户需要知道板怎么拼。
  if (layout.boards && layout.boards.rows * layout.boards.cols > 1) {
    drawBoardOverviewPage(
      doc.addPage([PAGE_W_PT, PAGE_H_PT]),
      layout.boards,
      W,
      H,
      name,
      font,
      cjk,
      metrics,
      measure,
    );
  }

  for (const page of layout.gridPages) {
    const pdfPage = doc.addPage([PAGE_W_PT, PAGE_H_PT]);
    const gridTop = PAGE_H_PT - marginPt - headerPt;
    const gridH = page.rows * cellPt;
    const gridW = page.cols * cellPt;
    const gridBottom = gridTop - gridH;

    // 页眉（第 x/y 页 · 行列区间）
    const header = pageHeaderText(page);
    pdfPage.drawText(cjk ? header : toWinAnsi(header), {
      x: marginPt,
      y: gridTop + 4,
      size: 9,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    // 图纸外框
    pdfPage.drawRectangle({
      x: marginPt,
      y: gridBottom,
      width: gridW,
      height: gridH,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.8,
    });

    // 单元格（透明/外部格不绘制）
    for (let lr = 0; lr < page.rows; lr++) {
      for (let lc = 0; lc < page.cols; lc++) {
        const cell = cells[(page.rowStart + lr) * W + (page.colStart + lc)];
        if (!cell || cell.transparent || cell.external || cell.hex === null) continue;
        const parsed = hexToRgb(cell.hex);
        if (!parsed) continue;
        const x = marginPt + lc * cellPt;
        const y = gridTop - (lr + 1) * cellPt;
        pdfPage.drawRectangle({
          x,
          y,
          width: cellPt,
          height: cellPt,
          color: rgb(parsed.r / 255, parsed.g / 255, parsed.b / 255),
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.35,
        });
        if (cell.code) {
          const label = truncateTextToWidth(cell.code, 4, cellPt - 2, '...', measure);
          const safe = cjk ? label : toWinAnsi(label);
          const textWidth = font.widthOfTextAtSize(safe, 4);
          const isLight = contrastColor(cell.hex) === '#000000';
          pdfPage.drawText(safe, {
            x: x + (cellPt - textWidth) / 2,
            y: y + (cellPt - 4) / 2,
            size: 4,
            font,
            color: isLight ? rgb(0, 0, 0) : rgb(1, 1, 1),
          });
        }
      }
    }

    // 板缝线（按当前制作规格，全局位置落在本页内）
    const seams = seamPositionsForPage(page, options.boardSize);
    for (const s of seams.cols) {
      const x = marginPt + (s - page.colStart) * cellPt;
      pdfPage.drawLine({
        start: { x, y: gridTop },
        end: { x, y: gridBottom },
        thickness: 1.2,
        color: rgb(0, 0, 0),
      });
    }
    for (const s of seams.rows) {
      const y = gridTop - (s - page.rowStart) * cellPt;
      pdfPage.drawLine({
        start: { x: marginPt, y },
        end: { x: marginPt + gridW, y },
        thickness: 1.2,
        color: rgb(0, 0, 0),
      });
    }
  }

  // 图例与用量清单（超过单页可见容量时分页）
  const sortedStats = sortStatsForLegend(stats);
  const legendPages = paginateLegendItems(sortedStats, metrics, measure);
  const legendColumnCount = legendColumnsForItems(sortedStats, A4_WIDTH_MM - 2 * metrics.marginMm, 8, measure);
  const totalCount = totalBeadCount(sortedStats);
  legendPages.forEach((pageStats, index) => {
    const legendPage = doc.addPage([PAGE_W_PT, PAGE_H_PT]);
    drawLegend(
      legendPage,
      font,
      name,
      pageStats,
      cjk,
      metrics,
      totalCount,
      index + 1,
      legendPages.length,
      legendColumnCount,
      measure,
    );
  });

  return doc.save();
}
