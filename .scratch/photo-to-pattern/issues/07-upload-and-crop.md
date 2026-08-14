# 07: 上传与裁剪流程

- Status: resolved

## 完成记录

- **自研裁剪组件**（未采用 react-cropper：其 React 19 peer 依赖不兼容），全部矩形几何下沉到纯函数模块。
- 文件清单：
  - `src/lib/crop/layout.ts`（纯函数：clampCropRect / applyAspectLock / cropImageData，含 MIN_CROP_SIZE=4、AspectAnchor；0×0、1×1、负宽高、越界、非整数、极宽图全安全）
  - `src/lib/crop/layout.test.ts`（20 例：钳制矩阵、五锚点 1:1/原始比例锁、比例属性验证、像素精确性、alpha 保持、整图一致）
  - `src/components/upload/UploadDropzone.tsx`（拖拽+点击+移动端 capture；FileReader 读取；多文件取第一张；错误按 zhCN.errors[code] 展示可重试；键盘可操作）
  - `src/components/upload/UploadDropzone.test.tsx`（9 例：>20MB/动图/伪装文本/空文件拒绝文案、合法 PNG onValid、多文件仅第一张、重试清错、disabled、capture、错误码→文案映射完整性）
  - `src/components/crop/ImageCropper.tsx`（DecodedImage RGBA 直接上屏不调 getImageData；DPR 感知；四角缩放+内部拖动+点外新建选区；1:1/原始/自由锁定；键盘 1/10px 微调；确认/取消/整图）
  - `src/components/crop/ImageCropper.test.tsx`（6 例：渲染、1:1 锁定 50×50 与确认回传、整图回传、取消、原始比例、initialRect 钳制；canvas 以最小 2D 上下文桩替代）
  - `src/messages/zh-CN.ts` 新增 `upload`（9 键）与 `crop`（12 键）命名空间
- 门禁：typecheck ✓、lint ✓（单测由父代理运行：本沙箱禁 spawn 且本会话禁升级）。
- 父代理全量测试后的修复（已应用）：applyAspectLock 零尺寸矩形强制最小 1×1；cropImageData 改为与图像**求交**语义（越界部分裁掉、全在界外 0×0，与 clampCropRect 的"移入界内"语义分离）；原始比例锁 center 锚点期望修正为 y=8；UploadDropzone 用 `files[0]` 索引；非 mobile 时 capture 未渲染 → 断言 undefined。
- 推迟到 E2E（ticket 20）：PointerEvent 拖拽几何（jsdom 无 getBoundingClientRect/指针几何）、移动端手势、真实 HEIC/EXIF 解码路径。
- Blocked by: 04

## 目标

上传入口（拖拽/选择/拍照）与裁剪组件，串联进入参数面板。

## 范围

- 上传组件：拖拽区、点击选择、移动端拍照（`accept` + `capture`）；多文件取第一张；错误文案按 T04 错误分类矩阵展示（可重试）。
- 裁剪组件：react-cropper；自由框选 + 锁定 1:1 / 原始比例；移动端手势；透明 PNG 保持 alpha；裁剪结果 → 引擎可用的 ImageData。
- 状态流：上传 → 解码校验 → 裁剪（默认全图，可跳过）→ 参数面板。
- 20 MB / 64 M 像素上限的前端预检与后端无关（纯本地）。

## 不含

- 工作台整体组装（T12）。

## 规格引用

- spec §F1、§F2；边界 E1–E13（UI 呈现部分）。

## 验收标准

- [ ] 组件测试：每种错误分类显示对应文案并可重试。
- [ ] 裁剪：比例锁定、最小选区（如 ≥4×4）、裁剪结果尺寸与像素正确性断言。
- [ ] 移动端 viewport（Playwright）：拍照入口出现、手势裁剪可用。
- [ ] 透明 PNG 裁剪后 alpha 保持。

## 完成记录

（resolve 时填写）
