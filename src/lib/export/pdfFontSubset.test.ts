/**
 * PDF 字体子集选择（A-04）：常用字走约 1 MB 子集，生僻字回退全量。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import charsetData from './pdfSubsetCharset.json';
import {
  PDF_FULL_FONT_URL,
  PDF_SUBSET_FONT_URL,
  coveredBySubset,
  pdfFontUrlFor,
  subsetCharset,
} from './pdfFontSubset';

describe('PDF 子集字符集', () => {
  it('包含 GB2312 全部汉字（一级 3755 + 二级 3008）与 ASCII、排版符号', () => {
    expect(charsetData.count).toBe(6895);
    const charset = subsetCharset();
    // 一级字
    for (const char of ['啊', '作', '座', '爱', '中', '国']) expect(charset.has(char)).toBe(true);
    // 二级字（「草莓」的莓在二级区，这类字在设计名里很常见）
    for (const char of ['莓', '琳', '奕', '烨']) expect(charset.has(char)).toBe(true);
    for (const char of ['A', 'z', '0', '-', '（', '·', '×', '–']) expect(charset.has(char)).toBe(true);
  });

  it('不含无字形的私用区码位（U+E810 起是 GBK 未分配槽位的解码产物）', () => {
    const charset = subsetCharset();
    for (const codePoint of [0xe810, 0xe811, 0xe812, 0xe813, 0xe814]) {
      expect(charset.has(String.fromCodePoint(codePoint))).toBe(false);
    }
  });

  it('PDF 版式固定文案全部在覆盖范围内（页眉/图例/总计）', () => {
    // 这些是 pdfLayout.headerText / pdf.ts 实际绘制的文本形态；
    // 未来往 PDF 里加中文静态文案时，这条会先红——提示要么用覆盖内的字，要么扩子集。
    expect(coveredBySubset('第 3/7 页 · 列 1–31 · 行 1–45')).toBe(true);
    expect(coveredBySubset('图例 · 草莓熊（第 2/3 页）')).toBe(true);
    expect(coveredBySubset('总计：1234 粒')).toBe(true);
    expect(coveredBySubset('未命名设计')).toBe(true);
    expect(coveredBySubset('Legend · Total: 42 beads')).toBe(true);
  });

  it('常见设计名走子集；生僻字设计名回退全量字体', () => {
    expect(pdfFontUrlFor('小熊猫拼豆')).toBe(PDF_SUBSET_FONT_URL);
    expect(pdfFontUrlFor('草莓熊 C-01')).toBe(PDF_SUBSET_FONT_URL);
    // 「龘」不在 GB2312 内
    expect(pdfFontUrlFor('龘龘图纸')).toBe(PDF_FULL_FONT_URL);
    expect(pdfFontUrlFor('emoji 🐻')).toBe(PDF_FULL_FONT_URL);
  });

  it('空白字符不影响判断', () => {
    expect(coveredBySubset(' \n\t\r')).toBe(true);
    expect(coveredBySubset('')).toBe(true);
  });
});

describe('loadPdfCjkFont', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('常用字文本只请求子集字体', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { loadPdfCjkFont } = await import('./pdfFont');
    const bytes = await loadPdfCjkFont('草莓熊');
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(PDF_SUBSET_FONT_URL);
  });

  it('同一 URL 只请求一次（模块级缓存）', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([9])));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { loadPdfCjkFont } = await import('./pdfFont');
    await loadPdfCjkFont('熊');
    await loadPdfCjkFont('猫');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('子集文件缺失时回退全量字体，宁可慢也不掉字', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === PDF_SUBSET_FONT_URL
        ? new Response(null, { status: 404 })
        : new Response(new Uint8Array([7])),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { loadPdfCjkFont } = await import('./pdfFont');
    expect(await loadPdfCjkFont('熊')).toEqual(new Uint8Array([7]));
    expect(fetchMock).toHaveBeenNthCalledWith(1, PDF_SUBSET_FONT_URL);
    expect(fetchMock).toHaveBeenNthCalledWith(2, PDF_FULL_FONT_URL);
  });

  it('生僻字直接请求全量字体', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([5])));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { loadPdfCjkFont } = await import('./pdfFont');
    await loadPdfCjkFont('龘');
    expect(fetchMock).toHaveBeenCalledWith(PDF_FULL_FONT_URL);
  });

  it('两个字体都取不到时返回 null（PDF 走 ASCII 降级）', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const { loadPdfCjkFont } = await import('./pdfFont');
    expect(await loadPdfCjkFont('熊')).toBeNull();
  });
});
