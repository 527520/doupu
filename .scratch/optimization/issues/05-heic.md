# 05 HEIC WASM 兜底（Chrome/Firefox/Edge 上传 iPhone 照片）

Status: ready-for-agent

## 目标（spec F1 欠账）

当前 `convertHeicWithWasm` 是抛错占位：非 Safari 浏览器上传 HEIC 直接报「无法处理 HEIC」。要求：

1. 接入 heic2any（或等价 WASM 方案）实现 HEIC → PNG/JPEG 转换，动态 import 按需加载。
2. 转换期间 UI 显示进度（复用 Workbench busy 态 + 明确文案「正在转换 HEIC 照片…」）。
3. 转换失败（损坏文件/超大图）回退现有友好错误文案。
4. 输出结果继续走既有解码/校验管线（尺寸上限、像素上限）。

## 边界

- 只在嗅探为 HEIC 且浏览器无法原生解码时触发（Safari 原生路径不变）。
- 超大图（>8000×8000 或 >20MB）在转换前先行拒绝，避免 WASM 内存问题。
- 离线/加载失败：报「当前网络无法加载转换组件」类友好错误（新增文案 zh-CN）。

## 验收

- 单测：convertHeicWithWasm 的 mock 路径（成功/失败/超限）。
- E2E：上传伪 HEIC fixture → 浏览器不支持原生解码时显示转换进度文案（断言不崩溃、最终成功进入裁剪或给出友好错误，两者按浏览器能力皆合法）。
- 全量回归。

## 涉及文件

src/lib/image/decode.ts、src/lib/image/sniff.ts、src/components/workbench/Workbench.tsx、src/messages/zh-CN.ts、tests/fixtures/（伪 HEIC 已有 fake.heic）
