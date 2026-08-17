/**
 * PNG 图纸导出（spec §F7 PNG 部分）：
 * 布局计算与 Canvas 绘制分离；空图纸（E10/E24）返回错误，不产出文件。
 */
import { computeStats } from '@/lib/engine/generate';
import { boardSeamPositions, contrastColor, labelVisible } from '@/lib/render/layout';
import type { Pattern } from '@/lib/types';
import {
  EXPORT_CELL_PX_DEFAULT,
  LEGEND_TEXT_GAP,
  clampCellPx,
  computePngCanvasLayout,
  contentBounds,
  legendEntryText,
  pngCanvasWithinLimits,
  pngFileName,
} from './layout';

export interface ExportPngOptions {
  /** 每格像素 8–48，默认 24 */
  cellPx?: number;
  /** 裁剪至内容（外部格包围盒），默认开 */
  cropToContent?: boolean;
  /** 下方换行图例（色块+色号+数量），默认关 */
  includeLegend?: boolean;
}

export type ExportPngResult =
  | { ok: true; blob: Blob; fileName: string }
  | { ok: false; code: 'EMPTY_PATTERN' | 'CANVAS_TOO_LARGE' | 'ENCODE_FAILED' };

const LABEL_FONT_FAMILY = 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';

/** 导出为 PNG Blob；空图纸返回 EMPTY_PATTERN（不创建 canvas）。 */
export function exportPngBlob(
  pattern: Pattern,
  designName: string,
  options: ExportPngOptions = {},
): Promise<ExportPngResult> {
  const bounds = contentBounds(pattern);
  if (!bounds) return Promise.resolve({ ok: false, code: 'EMPTY_PATTERN' });

  const cellPx = options.cellPx === undefined ? EXPORT_CELL_PX_DEFAULT : clampCellPx(options.cellPx);
  const crop = options.cropToContent ?? true;
  const includeLegend = options.includeLegend ?? false;

  const x0 = crop ? bounds.x0 : 0;
  const y0 = crop ? bounds.y0 : 0;
  const w = crop ? bounds.x1 - bounds.x0 + 1 : pattern.width;
  const h = crop ? bounds.y1 - bounds.y0 + 1 : pattern.height;
  const patternPxW = w * cellPx;
  const patternPxH = h * cellPx;

  const stats = computeStats(pattern.cells);
  const fontPx = Math.max(8, Math.floor(cellPx * 0.42));
  const font = `${fontPx}px ${LABEL_FONT_FAMILY}`;

  // 图例宽度（需要文本测量，仅 DOM 环境可用；无 DOM 时按保守估计）
  /** 图例列宽依据的最长文本宽度（px）——宽度计算与绘制两处必须用同一个值，避免长色号越界 */
  let legendTextPx = 0;
  if (includeLegend && stats.length > 0) {
    let maxTextPx = 0;
    if (typeof document !== 'undefined') {
      const measurer = document.createElement('canvas').getContext('2d');
      if (measurer) {
        measurer.font = font;
        for (const item of stats) {
          const measured = measurer.measureText(legendEntryText(item)).width;
          if (measured > maxTextPx) maxTextPx = Math.ceil(measured);
        }
      } else {
        maxTextPx = cellPx * 4;
      }
    } else {
      maxTextPx = cellPx * 4;
    }
    legendTextPx = Math.max(maxTextPx, 1);
  }

  const canvasLayout = computePngCanvasLayout({
    patternWidthPx: patternPxW,
    patternHeightPx: patternPxH,
    legendCount: includeLegend ? stats.length : 0,
    cellPx,
    legendTextPx,
  });
  if (!pngCanvasWithinLimits(canvasLayout)) {
    return Promise.resolve({ ok: false, code: 'CANVAS_TOO_LARGE' });
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvasLayout.width;
  canvas.height = Math.max(canvasLayout.height, 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve({ ok: false, code: 'ENCODE_FAILED' });

  // 色块（透明与外部格不绘制 → 透明背景）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = pattern.cells[(y + y0) * pattern.width + (x + x0)];
      if (cell.transparent || cell.external) continue;
      ctx.fillStyle = cell.hex!;
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
  }

  // 细网格线
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    ctx.moveTo(x * cellPx + 0.5, 0);
    ctx.lineTo(x * cellPx + 0.5, patternPxH);
  }
  for (let y = 0; y <= h; y++) {
    ctx.moveTo(0, y * cellPx + 0.5);
    ctx.lineTo(patternPxW, y * cellPx + 0.5);
  }
  ctx.stroke();

  // 板缝粗线（每 29 格；按内容坐标系）
  if (cellPx >= 4) {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(2, Math.round(cellPx / 8));
    ctx.beginPath();
    for (const p of boardSeamPositions(pattern.width)) {
      const lineX = (p - x0) * cellPx;
      if (lineX > 0 && lineX < patternPxW) {
        ctx.moveTo(lineX, 0);
        ctx.lineTo(lineX, patternPxH);
      }
    }
    for (const p of boardSeamPositions(pattern.height)) {
      const lineY = (p - y0) * cellPx;
      if (lineY > 0 && lineY < patternPxH) {
        ctx.moveTo(0, lineY);
        ctx.lineTo(patternPxW, lineY);
      }
    }
    ctx.stroke();
  }

  // 色号标注（格 ≥12px；外部格不标注）
  if (labelVisible(cellPx)) {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = pattern.cells[(y + y0) * pattern.width + (x + x0)];
        if (cell.transparent || cell.external || cell.code === null || cell.code === undefined) continue;
        ctx.fillStyle = contrastColor(cell.hex!);
        // Canvas' maxWidth contract horizontally condenses long custom colour
        // codes, keeping every label inside its own cell in all target engines.
        ctx.fillText(
          cell.code,
          x * cellPx + cellPx / 2,
          y * cellPx + cellPx / 2,
          Math.max(1, cellPx - 2),
        );
      }
    }
  }

  // 图例（图纸下方按行换行，确定性顺序来自 computeStats）
  if (includeLegend && stats.length > 0 && canvasLayout.legend) {
    const legend = canvasLayout.legend;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < stats.length; i++) {
      const col = i % legend.columns;
      const row = Math.floor(i / legend.columns);
      const x = legend.x + col * legend.columnWidth;
      const y = legend.y + row * legend.entryHeight + legend.entryHeight / 2;
      const item = stats[i];
      ctx.fillStyle = item.hex;
      ctx.fillRect(x, y - cellPx / 2, cellPx, cellPx);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y - cellPx / 2 + 0.5, cellPx - 1, cellPx - 1);
      ctx.fillStyle = '#1f2937';
      ctx.fillText(legendEntryText(item), x + cellPx + LEGEND_TEXT_GAP, y);
    }
  }

  return new Promise<ExportPngResult>((resolve) => {
    const fileName = pngFileName(designName, pattern.width, pattern.height);
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ ok: true, blob, fileName });
          else resolve({ ok: false, code: 'ENCODE_FAILED' });
        },
        'image/png',
      );
      return;
    }
    // 兜底：无 toBlob 的环境（旧浏览器）
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const binary = atob(dataUrl.split(',')[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      resolve({ ok: true, blob: new Blob([bytes], { type: 'image/png' }), fileName });
    } catch {
      resolve({ ok: false, code: 'ENCODE_FAILED' });
    }
  });
}
