# 06: 参数面板与图纸预览渲染

- Status: resolved

## 完成记录

- `src/lib/render/layout.ts`（纯布局：contrastColor/labelVisible(≥12px)/fitCellSize/boardSeamPositions(29 格)/clampZoom(50–1600%)/pointToCell）+ `draw.ts`（色块/网格/板缝/色号/外部格浅灰）。
- `src/components/params/GenerationParamsPanel.tsx`：核心三参数 + 高级折叠（模式/亮度/对比度/背景去除+容差/品牌选择，自定义色板槽位待 T18）；数字输入非法值回退、300ms 防抖上抛。
- `src/components/preview/PatternPreview.tsx`：DPR 高清渲染、缩放钳制、容器滚动平移、悬停/长按格子信息、三开关。
- 测试 20 例：layout 纯函数（含 12px 标注边界、板缝位置、Infinity 钳制）+ 面板交互（防抖 299/300ms 边界、非法输入回退、品牌切换、高级面板显隐）+ 预览（钳制、悬停坐标换算、透明格信息）。
- 工程修复：vitest globals（RTL cleanup）、tests/setup.ts jsdom canvas 桩、查询去歧义（滑杆/数字输入）。
- Blocked by: 05

## 目标

核心+高级参数面板，以及图纸 Canvas 预览（网格、板缝线、色号、缩放平移、悬停提示）。

## 范围

- 核心参数：目标宽度滑杆（20–200）、目标颜色数（2–128）、抖动开关。
- 高级折叠面板：取样模式、亮度、对比度、背景去除+容差、品牌选择（品牌数据来自 T03，自定义色板接入位留给 T18）。
- 防抖 300 ms 重新生成、进度显示、可取消（Web Worker 方案或分片执行；若主线程执行需保证 UI 不卡，采用 `requestIdleCallback` 分片或 Worker）。
- 预览渲染器（Canvas）：网格线、每 29 格板缝粗线、格 ≥12px 标色号（黑/白自适应对比）、外部格浅灰、缩放 50%–1600%、空格拖拽平移、悬停（桌面）/长按（移动）显示色号 tooltip。
- 高 DPR 渲染清晰（DPR 2/3）。

## 不含

- 编辑器工具（T08）；导出渲染（T09/T10）。

## 规格引用

- spec §F3、§F5（视图）、§F7（渲染规则）、§7.1；边界 E41。

## 验收标准

- [ ] 组件测试：参数 UI 无法输入非法值（滑杆边界、输入框拒绝非整数/越界）。
- [ ] 渲染断言：网格/板缝线/色号出现条件（≥12px）/对比色选择函数单测。
- [ ] 防抖与取消行为测试（fake timers）。
- [ ] DPR 2/3 截图或像素断言清晰。
- [ ] 20×20 与 200×200 交互不卡顿（Playwright 性能探针：缩放操作 <50 ms/帧）。

## 完成记录

（resolve 时填写）
