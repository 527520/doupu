/**
 * PDF 中文字体加载（Noto Sans SC，OFL 许可，见 public/fonts/OFL.txt 与 NOTICE.md）。
 * 浏览器端按需 fetch + 模块级缓存；失败返回 null（PDF 走 ASCII 降级路径）。
 */
let cached: Promise<Uint8Array | null> | null = null;

export function loadPdfCjkFont(): Promise<Uint8Array | null> {
  if (!cached) {
    cached = (async () => {
      try {
        const response = await fetch('/fonts/NotoSansCJKsc-Regular.otf');
        if (!response.ok) return null;
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        return null;
      }
    })();
  }
  return cached;
}

/** 测试隔离：清空字体缓存。 */
export function resetPdfFontCacheForTests(): void {
  cached = null;
}
