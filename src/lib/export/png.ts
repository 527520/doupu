/** PNG 图纸导出：统一规划、全不透明绘制，以及超限时图纸/图例拆分。 */
import { totalBeadCount } from '@/lib/engine/generate';
import { boardSeamPositions, contrastColor, labelVisible } from '@/lib/render/layout';
import type { Pattern, PatternStatsItem } from '@/lib/types';
import { zhCN } from '@/messages/zh-CN';
import { pngFileName } from './layout';
import {
  PNG_BACKGROUND,
  PNG_LEGEND_SWATCH_TEXT_GAP,
  createPngExportPlan,
  type PngExportPlan,
  type PngLegendPlan,
  type PngPatternPlan,
} from './pngPlan';

export interface ExportPngOptions {
  /** 每格像素 8–48，默认 24 */
  cellPx?: number;
  /** 裁剪至内容（外部格包围盒），默认开 */
  cropToContent?: boolean;
  /** 下方独立 footer 图例（色块+色号+数量），默认关 */
  includeLegend?: boolean;
  /** 当前制作规格的一块板边长；缺省保持兼容规格。 */
  boardSize?: number;
}

export interface PngArtifact {
  blob: Blob;
  fileName: string;
}

export type ExportPngResult =
  | { ok: true; kind: 'single'; artifact: PngArtifact }
  | {
      ok: true;
      kind: 'split';
      pattern: PngArtifact;
      legend: PngArtifact;
      archiveFileName: string;
    }
  | { ok: false; code: 'EMPTY_PATTERN' | 'CANVAS_TOO_LARGE' | 'ENCODE_FAILED' };

const LABEL_FONT_FAMILY = 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';

function splitArtifactNames(designName: string, width: number, height: number): {
  pattern: string;
  legend: string;
  archive: string;
} {
  const stem = pngFileName(designName, width, height).replace(/\.png$/u, '');
  return {
    pattern: zhCN.export.pngSplitPatternFile(stem),
    legend: zhCN.export.pngSplitLegendFile(stem),
    archive: zhCN.export.pngSplitArchiveFile(stem),
  };
}

function createOpaqueCanvas(size: { width: number; height: number }): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  const canvas = document.createElement('canvas');
  try {
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      releaseCanvas(canvas);
      return null;
    }
    ctx.fillStyle = PNG_BACKGROUND;
    ctx.fillRect(0, 0, size.width, size.height);
    return { canvas, ctx };
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  }
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  try {
    canvas.width = 1;
    canvas.height = 1;
  } catch {
    // 释放路径不应覆盖原始绘制/编码错误。
  }
}

function drawPattern(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  plan: PngPatternPlan,
  cellPx: number,
  originX: number,
  originY: number,
  boardSize?: number,
): void {
  const { sourceX, sourceY, widthCells, heightCells, width: patternPxW, height: patternPxH } = plan;

  for (let y = 0; y < heightCells; y++) {
    for (let x = 0; x < widthCells; x++) {
      const cell = pattern.cells[(y + sourceY) * pattern.width + (x + sourceX)];
      if (cell.transparent || cell.external) continue;
      ctx.fillStyle = cell.hex!;
      ctx.fillRect(originX + x * cellPx, originY + y * cellPx, cellPx, cellPx);
    }
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= widthCells; x++) {
    const lineX = originX + x * cellPx + 0.5;
    ctx.moveTo(lineX, originY);
    ctx.lineTo(lineX, originY + patternPxH);
  }
  for (let y = 0; y <= heightCells; y++) {
    const lineY = originY + y * cellPx + 0.5;
    ctx.moveTo(originX, lineY);
    ctx.lineTo(originX + patternPxW, lineY);
  }
  ctx.stroke();

  if (cellPx >= 4) {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(2, Math.round(cellPx / 8));
    ctx.beginPath();
    for (const position of boardSeamPositions(pattern.width, boardSize)) {
      const lineX = (position - sourceX) * cellPx;
      if (lineX > 0 && lineX < patternPxW) {
        ctx.moveTo(originX + lineX, originY);
        ctx.lineTo(originX + lineX, originY + patternPxH);
      }
    }
    for (const position of boardSeamPositions(pattern.height, boardSize)) {
      const lineY = (position - sourceY) * cellPx;
      if (lineY > 0 && lineY < patternPxH) {
        ctx.moveTo(originX, originY + lineY);
        ctx.lineTo(originX + patternPxW, originY + lineY);
      }
    }
    ctx.stroke();
  }

  if (!labelVisible(cellPx)) return;
  const fontPx = Math.max(8, Math.floor(cellPx * 0.42));
  ctx.font = `${fontPx}px ${LABEL_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let y = 0; y < heightCells; y++) {
    for (let x = 0; x < widthCells; x++) {
      const cell = pattern.cells[(y + sourceY) * pattern.width + (x + sourceX)];
      if (cell.transparent || cell.external || cell.code === null || cell.code === undefined) continue;
      ctx.fillStyle = contrastColor(cell.hex!);
      ctx.fillText(
        cell.code,
        originX + x * cellPx + cellPx / 2,
        originY + y * cellPx + cellPx / 2,
        Math.max(1, cellPx - 2),
      );
    }
  }
}

function legendEntryText(item: PatternStatsItem): string {
  return `${item.code} × ${item.count}`;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  stats: PatternStatsItem[],
  plan: PngLegendPlan,
  originX: number,
  originY: number,
): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#2f2738';
  ctx.font = `600 ${plan.titleFontPx}px ${LABEL_FONT_FAMILY}`;
  ctx.fillText(zhCN.export.legendTitle, originX + plan.padding, originY + plan.titleBaseline);

  ctx.fillStyle = '#675f6f';
  ctx.font = `${plan.bodyFontPx}px ${LABEL_FONT_FAMILY}`;
  ctx.fillText(
    zhCN.export.legendSummary(stats.length, totalBeadCount(stats)),
    originX + plan.padding,
    originY + plan.summaryBaseline,
  );

  ctx.strokeStyle = '#ded8e4';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(originX + plan.padding, originY + plan.dividerY + 0.5);
  ctx.lineTo(originX + plan.width - plan.padding, originY + plan.dividerY + 0.5);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  for (let index = 0; index < stats.length; index++) {
    const column = index % plan.columns;
    const row = Math.floor(index / plan.columns);
    const entryX = originX + plan.padding + column * plan.columnWidth;
    const centerY = originY + plan.entriesY + row * plan.rowHeight + plan.rowHeight / 2;
    const item = stats[index];

    ctx.fillStyle = item.hex;
    ctx.fillRect(entryX, centerY - plan.swatchPx / 2, plan.swatchPx, plan.swatchPx);
    ctx.strokeStyle = '#91879d';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      entryX + 0.5,
      centerY - plan.swatchPx / 2 + 0.5,
      plan.swatchPx - 1,
      plan.swatchPx - 1,
    );

    ctx.fillStyle = '#2f2738';
    ctx.fillText(
      legendEntryText(item),
      entryX + plan.swatchPx + PNG_LEGEND_SWATCH_TEXT_GAP,
      centerY,
      plan.maxTextWidth,
    );
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  try {
    const dataUrl = canvas.toDataURL('image/png');
    const binary = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return Promise.resolve(new Blob([bytes], { type: 'image/png' }));
  } catch {
    return Promise.resolve(null);
  }
}

async function renderSingle(
  pattern: Pattern,
  plan: Extract<PngExportPlan, { kind: 'single' }>,
  boardSize: number | undefined,
): Promise<Blob | null> {
  const target = createOpaqueCanvas(plan.canvas);
  if (!target) return null;
  try {
    drawPattern(
      target.ctx,
      pattern,
      plan.pattern,
      plan.cellPx,
      plan.canvas.patternX,
      plan.canvas.patternY,
      boardSize,
    );
    if (plan.legend) {
      drawLegend(target.ctx, plan.stats, plan.legend, plan.canvas.legendX, plan.canvas.legendY);
    }
    return await canvasToBlob(target.canvas);
  } finally {
    releaseCanvas(target.canvas);
  }
}

async function renderSplit(
  pattern: Pattern,
  plan: Extract<PngExportPlan, { kind: 'split' }>,
  boardSize: number | undefined,
): Promise<{ pattern: Blob; legend: Blob } | null> {
  const patternTarget = createOpaqueCanvas(plan.patternCanvas);
  if (!patternTarget) return null;
  let patternBlob: Blob | null;
  try {
    drawPattern(patternTarget.ctx, pattern, plan.pattern, plan.cellPx, 0, 0, boardSize);
    patternBlob = await canvasToBlob(patternTarget.canvas);
  } finally {
    releaseCanvas(patternTarget.canvas);
  }
  if (!patternBlob) return null;

  const legendTarget = createOpaqueCanvas(plan.legendCanvas);
  if (!legendTarget) return null;
  try {
    drawLegend(legendTarget.ctx, plan.stats, plan.legend, 0, 0);
    const legendBlob = await canvasToBlob(legendTarget.canvas);
    return legendBlob ? { pattern: patternBlob, legend: legendBlob } : null;
  } finally {
    releaseCanvas(legendTarget.canvas);
  }
}

/** 导出为单张 PNG，或在合并画布超限时导出图纸/图例两张 artifact。 */
export async function exportPngBlob(
  pattern: Pattern,
  designName: string,
  options: ExportPngOptions = {},
): Promise<ExportPngResult> {
  try {
    const plan = createPngExportPlan(pattern, options);
    if (plan.kind === 'empty') return { ok: false, code: 'EMPTY_PATTERN' };
    if (plan.kind === 'too-large') return { ok: false, code: 'CANVAS_TOO_LARGE' };

    if (plan.kind === 'single') {
      const blob = await renderSingle(pattern, plan, options.boardSize);
      if (!blob) return { ok: false, code: 'ENCODE_FAILED' };
      return {
        ok: true,
        kind: 'single',
        artifact: { blob, fileName: pngFileName(designName, pattern.width, pattern.height) },
      };
    }

    const blobs = await renderSplit(pattern, plan, options.boardSize);
    if (!blobs) return { ok: false, code: 'ENCODE_FAILED' };
    const names = splitArtifactNames(designName, pattern.width, pattern.height);
    return {
      ok: true,
      kind: 'split',
      pattern: { blob: blobs.pattern, fileName: names.pattern },
      legend: { blob: blobs.legend, fileName: names.legend },
      archiveFileName: names.archive,
    };
  } catch {
    return { ok: false, code: 'ENCODE_FAILED' };
  }
}
