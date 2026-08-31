import { computeStats } from '@/lib/engine/generate';
import type { Pattern, PatternStatsItem } from '@/lib/types';
import {
  EXPORT_CELL_PX_DEFAULT,
  clampCellPx,
  contentBounds,
  pngCanvasWithinLimits,
} from './layout';

export const PNG_BACKGROUND = '#ffffff';
export const PNG_FOOTER_GAP = 24;
export const PNG_FOOTER_PADDING = 24;
export const PNG_LEGEND_MIN_WIDTH = 960;
export const PNG_LEGEND_STANDALONE_MAX_WIDTH = 1600;
export const PNG_LEGEND_BODY_FONT_MIN = 16;
export const PNG_LEGEND_BODY_FONT_MAX = 22;
export const PNG_LEGEND_SWATCH_MIN = 24;
export const PNG_LEGEND_ROW_MIN = 32;
export const PNG_LEGEND_COLUMN_GAP = 24;
export const PNG_LEGEND_SWATCH_TEXT_GAP = 12;
export const PNG_LEGEND_MAX_COLUMNS = 10;

export type PngTextMeasurer = (text: string, fontPx: number, weight?: 400 | 600) => number;

export interface PngExportPlanOptions {
  cellPx?: number;
  cropToContent?: boolean;
  includeLegend?: boolean;
}

export interface PngPatternPlan {
  sourceX: number;
  sourceY: number;
  widthCells: number;
  heightCells: number;
  width: number;
  height: number;
}

export interface PngLegendPlan {
  width: number;
  height: number;
  padding: number;
  titleFontPx: number;
  bodyFontPx: number;
  swatchPx: number;
  rowHeight: number;
  maxTextWidth: number;
  columnWidth: number;
  columns: number;
  rows: number;
  titleBaseline: number;
  summaryBaseline: number;
  dividerY: number;
  entriesY: number;
}

interface PngReadyPlanBase {
  pattern: PngPatternPlan;
  legend: PngLegendPlan | null;
  stats: PatternStatsItem[];
  cellPx: number;
}

export type PngExportPlan =
  | { kind: 'empty' }
  | (PngReadyPlanBase & { kind: 'too-large'; reason: 'pattern' | 'legend' })
  | (PngReadyPlanBase & {
      kind: 'single';
      canvas: {
        width: number;
        height: number;
        patternX: number;
        patternY: number;
        legendX: number;
        legendY: number;
      };
    })
  | (PngReadyPlanBase & {
      kind: 'split';
      legend: PngLegendPlan;
      patternCanvas: { width: number; height: number };
      legendCanvas: { width: number; height: number };
    });

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Canvas 与 UI 共用的确定性文字宽度估算。
 *
 * 色号最长 20 字符；在无法读取真实字体度量时，每个字符均按保守的 1em 计算。
 * 规划器允许注入浏览器 measureText，但默认估算能在 SSR、测试与不支持 Canvas 的环境保持一致。
 */
export const defaultPngTextMeasurer: PngTextMeasurer = (text, fontPx, weight = 400) => {
  const em = Array.from(text).length;
  const weightAllowance = weight === 600 ? 1.04 : 1;
  return Math.ceil(em * fontPx * weightAllowance);
};

function legendMetrics(cellPx: number): {
  bodyFontPx: number;
  titleFontPx: number;
  swatchPx: number;
  rowHeight: number;
} {
  const bodyFontPx = clamp(Math.round(cellPx * 0.75), PNG_LEGEND_BODY_FONT_MIN, PNG_LEGEND_BODY_FONT_MAX);
  const titleFontPx = Math.max(24, bodyFontPx + 4);
  const swatchPx = Math.max(PNG_LEGEND_SWATCH_MIN, bodyFontPx + 4);
  const rowHeight = Math.max(PNG_LEGEND_ROW_MIN, swatchPx + 8, bodyFontPx + 10);
  return { bodyFontPx, titleFontPx, swatchPx, rowHeight };
}

function legendEntryText(item: PatternStatsItem): string {
  return `${item.code} × ${item.count}`;
}

function naturalLegendColumnWidth(
  stats: PatternStatsItem[],
  metrics: ReturnType<typeof legendMetrics>,
  measureText: PngTextMeasurer,
): { width: number; maxTextWidth: number } {
  const maxTextWidth = stats.reduce(
    (max, item) => Math.max(max, Math.ceil(measureText(legendEntryText(item), metrics.bodyFontPx, 400))),
    0,
  );
  return {
    width: metrics.swatchPx + PNG_LEGEND_SWATCH_TEXT_GAP + maxTextWidth + PNG_LEGEND_COLUMN_GAP,
    maxTextWidth,
  };
}

function createLegendPlan(
  stats: PatternStatsItem[],
  width: number,
  metrics: ReturnType<typeof legendMetrics>,
  naturalColumn: { width: number; maxTextWidth: number },
): PngLegendPlan {
  const contentWidth = width - PNG_FOOTER_PADDING * 2;
  const columns = Math.max(
    1,
    Math.min(
      PNG_LEGEND_MAX_COLUMNS,
      stats.length,
      Math.floor(contentWidth / naturalColumn.width),
    ),
  );
  const columnWidth = Math.floor(contentWidth / columns);
  const rows = Math.ceil(stats.length / columns);
  const titleBaseline = PNG_FOOTER_PADDING + metrics.titleFontPx;
  const summaryBaseline = titleBaseline + metrics.bodyFontPx + 12;
  const dividerY = summaryBaseline + 16;
  const entriesY = dividerY + 16;
  const height = entriesY + rows * metrics.rowHeight + PNG_FOOTER_PADDING;
  return {
    width,
    height,
    padding: PNG_FOOTER_PADDING,
    titleFontPx: metrics.titleFontPx,
    bodyFontPx: metrics.bodyFontPx,
    swatchPx: metrics.swatchPx,
    rowHeight: metrics.rowHeight,
    maxTextWidth: naturalColumn.maxTextWidth,
    columnWidth,
    columns,
    rows,
    titleBaseline,
    summaryBaseline,
    dividerY,
    entriesY,
  };
}

/**
 * PNG 导出的唯一规划入口。此函数不读取 DOM、不创建 Canvas；导出按钮的预检与绘制路径
 * 必须使用同一个 plan，避免 UI 说“可导出”而实际分配失败，或实际偷偷缩小图例。
 */
export function createPngExportPlan(
  pattern: Pattern,
  options: PngExportPlanOptions = {},
  measureText: PngTextMeasurer = defaultPngTextMeasurer,
): PngExportPlan {
  const bounds = contentBounds(pattern);
  if (!bounds) return { kind: 'empty' };

  const cellPx = options.cellPx === undefined ? EXPORT_CELL_PX_DEFAULT : clampCellPx(options.cellPx);
  const crop = options.cropToContent ?? true;
  const sourceX = crop ? bounds.x0 : 0;
  const sourceY = crop ? bounds.y0 : 0;
  const widthCells = crop ? bounds.x1 - bounds.x0 + 1 : pattern.width;
  const heightCells = crop ? bounds.y1 - bounds.y0 + 1 : pattern.height;
  const patternPlan: PngPatternPlan = {
    sourceX,
    sourceY,
    widthCells,
    heightCells,
    width: widthCells * cellPx,
    height: heightCells * cellPx,
  };
  const stats = computeStats(pattern.cells);
  const base = { pattern: patternPlan, stats, cellPx };

  if (!pngCanvasWithinLimits(patternPlan)) {
    return { ...base, kind: 'too-large', reason: 'pattern', legend: null };
  }

  if (!(options.includeLegend ?? false) || stats.length === 0) {
    return {
      ...base,
      kind: 'single',
      legend: null,
      canvas: {
        width: patternPlan.width,
        height: patternPlan.height,
        patternX: 0,
        patternY: 0,
        legendX: 0,
        legendY: patternPlan.height,
      },
    };
  }

  const metrics = legendMetrics(cellPx);
  const naturalColumn = naturalLegendColumnWidth(stats, metrics, measureText);
  const minLegendWidth = Math.max(
    PNG_LEGEND_MIN_WIDTH,
    PNG_FOOTER_PADDING * 2 + naturalColumn.width,
  );
  const combinedWidth = Math.max(patternPlan.width, minLegendWidth);
  const combinedLegend = createLegendPlan(stats, combinedWidth, metrics, naturalColumn);
  const combinedHeight = patternPlan.height + PNG_FOOTER_GAP + combinedLegend.height;

  if (pngCanvasWithinLimits({ width: combinedWidth, height: combinedHeight })) {
    return {
      ...base,
      kind: 'single',
      legend: combinedLegend,
      canvas: {
        width: combinedWidth,
        height: combinedHeight,
        patternX: Math.floor((combinedWidth - patternPlan.width) / 2),
        patternY: 0,
        legendX: 0,
        legendY: patternPlan.height + PNG_FOOTER_GAP,
      },
    };
  }

  const standaloneWidth = Math.max(
    minLegendWidth,
    Math.min(PNG_LEGEND_STANDALONE_MAX_WIDTH, patternPlan.width),
  );
  const standaloneLegend = createLegendPlan(stats, standaloneWidth, metrics, naturalColumn);
  if (!pngCanvasWithinLimits(standaloneLegend)) {
    return { ...base, kind: 'too-large', reason: 'legend', legend: standaloneLegend };
  }

  return {
    ...base,
    kind: 'split',
    legend: standaloneLegend,
    patternCanvas: { width: patternPlan.width, height: patternPlan.height },
    legendCanvas: { width: standaloneLegend.width, height: standaloneLegend.height },
  };
}

export function largestFittingPngCellPx(
  pattern: Pattern,
  choices: readonly number[],
  options: Omit<PngExportPlanOptions, 'cellPx'>,
  measureText: PngTextMeasurer = defaultPngTextMeasurer,
): number {
  const ascending = [...choices].sort((a, b) => a - b);
  let best = ascending[0] ?? EXPORT_CELL_PX_DEFAULT;
  for (const cellPx of ascending) {
    const plan = createPngExportPlan(pattern, { ...options, cellPx }, measureText);
    if (plan.kind === 'single' || plan.kind === 'split') best = cellPx;
  }
  return best;
}
