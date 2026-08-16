import { describe, expect, it } from 'vitest';
import { publicConfigFallback, type PublicConfig } from './config';

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
});
