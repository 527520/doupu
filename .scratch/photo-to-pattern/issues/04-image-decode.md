# 04: 图像解码与输入校验模块

- Status: open
- Blocked by: 02

## 目标

统一的图片输入处理层：类型嗅探、上限校验、动图检测、HEIC 路由、EXIF 方向、错误分类。

## 范围

- `src/lib/image/`（纯逻辑）+ 浏览器适配层：
  - 类型嗅探：魔数优先 + 扩展名兜底；JPEG/PNG/WebP/HEIC 识别。
  - 上限校验：文件 ≤20 MB；解码后像素 ≤64 M（8000×8000）。
  - 动图检测：GIF（帧分隔符/应用扩展）、APNG（acTL chunk）、动画 WebP（ANIM chunk）→ `ANIMATED` 错误。
  - HEIC：`ftyp heic/heix` 检测；浏览器原生解码探测（`createImageBitmap`/Safari）与 WASM（heic2any）路由；转码进度回调。
  - EXIF：`createImageBitmap(…, { imageOrientation: 'from-image' })` 封装。
  - 错误分类枚举：`EMPTY_FILE / UNSUPPORTED_TYPE / TOO_LARGE_FILE / TOO_MANY_PIXELS / ANIMATED / DECODE_FAILED / HEIC_UNSUPPORTED`，每类映射 spec §F1 文案。
- 检入测试 fixture：HEIC、EXIF 旋转 JPEG（1/3/6/8 方向）、动画 GIF/APNG/WebP、截断 JPEG/PNG、1×1 PNG、全透明 PNG、半透明 PNG、16-bit PNG、100:1 极宽图、8×8 小图（fixture 放 `tests/fixtures/`，来源：程序生成脚本 `tests/fixtures/generate.mjs` 一并提交，保证可复现）。

## 不含

- 生成引擎（T05）；上传/裁剪 UI（T07）；E2E 用例（T20 复用 fixture）。

## 规格引用

- spec §F1；边界 E1–E13（模块可断言部分）。

## 验收标准

- [ ] 纯逻辑单测：嗅探、上限、动图检测、错误分类（用 fixture 字节断言）。
- [ ] 浏览器集成测试（Vitest browser 或 Playwright 单测项目）：解码结果尺寸/方向断言（EXIF、透明、16-bit）。
- [ ] HEIC：Safari/Chromium 行为断言（Chromium 走 WASM 兜底，转码失败给出 HEIC_UNSUPPORTED）。
- [ ] fixture 生成脚本可一键重建全部 fixture。

## 完成记录

（resolve 时填写）
