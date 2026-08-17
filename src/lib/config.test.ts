import { describe, expect, it } from 'vitest';
import { normalizePdfMetrics, publicConfigFallback, type PublicConfig } from './config';

describe('config（票 02）', () => {
  it('公开配置回退值与历史默认一致（未配置环境变量时行为不变）', () => {
    const cfg: PublicConfig = publicConfigFallback;
    expect(cfg.generation).toEqual({ defaultWidth: 100, defaultColorCount: 40 });
    expect(cfg.exportPng).toEqual({ cellPx: 24, cropToContent: true, includeLegend: false });
    expect(cfg.exportPdf).toEqual({ cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 });
  });

  it('公开配置不含任何敏感项（限流/会话/体积字段不存在）', () => {
    const keys = Object.keys(publicConfigFallback);
    expect(keys).not.toContain('security');
    expect(keys).not.toContain('features');
  });

  it('PDF 参数单项合法但整组超出 A4 时整组回退', () => {
    const fallback = publicConfigFallback.exportPdf;
    expect(normalizePdfMetrics({ cellMm: 20, marginMm: 30, headerMm: 30, pageCols: 100, pageRows: 100 }, fallback))
      .toEqual(fallback);
  });

  it('PDF 整组中的非有限数、非正尺寸或非正整数页格均回退', () => {
    const fallback = publicConfigFallback.exportPdf;
    expect(normalizePdfMetrics({ cellMm: -1, marginMm: 0, headerMm: 0, pageCols: 0, pageRows: 1 }, fallback))
      .toEqual(fallback);
    expect(normalizePdfMetrics({ ...fallback, cellMm: Number.NaN }, fallback)).toEqual(fallback);
  });
});
