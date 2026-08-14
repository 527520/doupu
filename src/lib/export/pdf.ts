/**
 * 打印版 PDF 生成（spec §F7 PDF 部分）。
 * 依赖 pdf-lib；布局计算全部委托 pdfLayout.ts。
 * 文本：传入 CJK 字体字节（Noto Sans SC，OFL）时嵌入子集并输出中文；
 * 未传入时回退 Helvetica + WinAnsi（非 ASCII 替换为 '?'，仅用于测试/降级路径）。
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { hexToRgb } from '@/lib/engine/color';
import { contrastColor } from '@/lib/render/layout';
import { zhCN } from '@/messages/zh-CN';
import type { Pattern, PatternStatsItem } from '@/lib/types';
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  MM_TO_PT,
  PDF_CELL_MM,
  PDF_HEADER_MM,
  PDF_MARGIN_MM,
  computePdfLayout,
  legendColumns,
  pageHeaderText,
  seamPositionsForPage,
  sortStatsForLegend,
  toWinAnsi,
  truncateTextToWidth,
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
}

const PAGE_W_PT = A4_WIDTH_MM * MM_TO_PT;
const PAGE_H_PT = A4_HEIGHT_MM * MM_TO_PT;
const MARGIN_PT = PDF_MARGIN_MM * MM_TO_PT;
const HEADER_PT = PDF_HEADER_MM * MM_TO_PT;
const CELL_PT = PDF_CELL_MM * MM_TO_PT;

function drawLegend(
  page: PDFPage,
  font: PDFFont,
  name: string,
  stats: PatternStatsItem[],
  cjk: boolean,
): void {
  const t = zhCN.export;
  const top = PAGE_H_PT - MARGIN_PT;
  const rawTitle = cjk ? `${t.legendTitle} · ${name.trim()}` : `Legend · ${name.trim()}`;
  const title = truncateTextToWidth(rawTitle || 'Pattern', 12, PAGE_W_PT - 2 * MARGIN_PT, '...');
  page.drawText(cjk ? title : toWinAnsi(title), { x: MARGIN_PT, y: top - 14, size: 12, font });

  const items = sortStatsForLegend(stats);
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const totalText = cjk ? `总计：${total} ${t.countUnit}` : `Total: ${total} beads`;
  page.drawText(totalText, { x: MARGIN_PT, y: top - 28, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
  if (items.length === 0) return;

  const usableMm = A4_WIDTH_MM - 2 * PDF_MARGIN_MM;
  const cols = legendColumns(usableMm);
  const itemW = (usableMm * MM_TO_PT) / cols;
  const rowH = 14;
  const listTop = top - 46;
  const maxTextWidth = itemW - 16;

  items.forEach((item, index) => {
    const c = index % cols;
    const r = Math.floor(index / cols);
    const x = MARGIN_PT + c * itemW;
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
    const code = truncateTextToWidth(item.code, 8, maxTextWidth, '...');
    const text = `${cjk ? code : toWinAnsi(code)} x${item.count}`;
    page.drawText(text, { x: x + 12, y: y - 7, size: 8, font });
  });
}

/** 生成分页拼图 PDF；返回 PDF 字节。 */
export async function generatePatternPdf(
  input: PdfExportInput,
  options: PdfExportOptions = {},
): Promise<Uint8Array> {
  const { name, pattern, stats } = input;
  const { width: W, height: H, cells } = pattern;
  const layout = computePdfLayout(W, H);
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

  for (const page of layout.gridPages) {
    const pdfPage = doc.addPage([PAGE_W_PT, PAGE_H_PT]);
    const gridTop = PAGE_H_PT - MARGIN_PT - HEADER_PT;
    const gridH = page.rows * CELL_PT;
    const gridW = page.cols * CELL_PT;
    const gridBottom = gridTop - gridH;

    // 页眉（第 x/y 页 · 行列区间）
    const header = pageHeaderText(page);
    pdfPage.drawText(cjk ? header : toWinAnsi(header), {
      x: MARGIN_PT,
      y: gridTop + 4,
      size: 9,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    // 图纸外框
    pdfPage.drawRectangle({
      x: MARGIN_PT,
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
        const x = MARGIN_PT + lc * CELL_PT;
        const y = gridTop - (lr + 1) * CELL_PT;
        pdfPage.drawRectangle({
          x,
          y,
          width: CELL_PT,
          height: CELL_PT,
          color: rgb(parsed.r / 255, parsed.g / 255, parsed.b / 255),
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.35,
        });
        if (cell.code) {
          const label = truncateTextToWidth(cell.code, 4, CELL_PT - 2, '...');
          const safe = cjk ? label : toWinAnsi(label);
          const textWidth = font.widthOfTextAtSize(safe, 4);
          const isLight = contrastColor(cell.hex) === '#000000';
          pdfPage.drawText(safe, {
            x: x + (CELL_PT - textWidth) / 2,
            y: y + (CELL_PT - 4) / 2,
            size: 4,
            font,
            color: isLight ? rgb(0, 0, 0) : rgb(1, 1, 1),
          });
        }
      }
    }

    // 板缝线（每 29 格，全局位置落在本页内）
    const seams = seamPositionsForPage(page);
    for (const s of seams.cols) {
      const x = MARGIN_PT + (s - page.colStart) * CELL_PT;
      pdfPage.drawLine({
        start: { x, y: gridTop },
        end: { x, y: gridBottom },
        thickness: 1.2,
        color: rgb(0, 0, 0),
      });
    }
    for (const s of seams.rows) {
      const y = gridTop - (s - page.rowStart) * CELL_PT;
      pdfPage.drawLine({
        start: { x: MARGIN_PT, y },
        end: { x: MARGIN_PT + gridW, y },
        thickness: 1.2,
        color: rgb(0, 0, 0),
      });
    }
  }

  // 图例与用量清单页（末页）
  const legendPage = doc.addPage([PAGE_W_PT, PAGE_H_PT]);
  drawLegend(legendPage, font, name, stats, cjk);

  return doc.save();
}
