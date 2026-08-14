# 09: PNG 图纸导出

- Status: resolved

## 完成记录

- `src/lib/export/layout.ts`：contentBounds（含端点包围盒，忽略透明/外部）、clampCellPx（8–48，NaN 回退 24，四舍五入）、sanitizeFilename（规则锁定：trim→空=未命名设计→非法字符/控制符→'-'→折叠连续'-'→去首尾'-'→再空回退）、pngFileName（豆谱-<名>-<W>x<H>.png）、图例布局（条目高 max(16,cellPx+6)、每列条目数、列数、列宽、条目文本）。
- `src/lib/export/png.ts`：exportPngBlob —— 空图纸在创建 canvas 前返回 EMPTY_PATTERN（E10/E24）；裁剪至内容（默认）、图例（默认关、按列排布、computeStats 确定性顺序）、网格/板缝（按内容坐标系换算）/≥12px 色号标注/外部格透明；toBlob + toDataURL 兜底；ENCODE_FAILED 分支。
- 组件 `src/components/export/PngExportButton.tsx`：空图纸禁用、下载（objectURL+anchor+释放）、失败可重试提示。
- 测试：layout 30 例（包围盒 5 种形态、钳制边界、文件名清洗全矩阵含 100 字符/控制符/全非法、图例 1/10/291 色列数）；png.test 5 例（Node 环境空图纸分支）；按钮 jsdom 5 例（禁用、下载链路、toBlob null 失败文案、download 文件名断言）。
- typecheck/lint 对本票文件零错误（当前 tsc 报错均来自 db/* 属 T13 未装依赖，与本票无关）。测试运行由父代理执行。
- Blocked by: 06

## 目标

PNG 图纸导出：可调格子尺寸、板缝线、色号标注、裁剪至内容、可选图例。

## 范围

- 导出渲染器（纯布局计算 + Canvas 绘制分离）：每格 8–48 px 可选（默认 24）；细网格线；每 29 格板缝粗线；格 ≥12px 标注色号（自适应对比色）；「裁剪至内容」默认开（外部格包围盒裁剪）；图例开关（右侧图例区：色块+色号+数量，多列换行）。
- 外部格透明；全透明图纸（E10/E24）导出前提示。
- 文件名：`豆谱-<设计名>-<W>x<H>.png`（设计名为空用「未命名设计」，非法文件名字符替换）。
- `canvas.toBlob('image/png')` 下载；失败可重试提示。

## 不含

- PDF（T10）；工作台集成（T12）。

## 规格引用

- spec §F7 PNG 部分；边界 E25–E27（PNG 侧）、E10、E24。

## 验收标准

- [ ] 单测：布局计算（包围盒、图例排布行列数、对比色选择、文件名清洗）。
- [ ] 导出文件断言：尺寸 = 内容格数×格子px + 图例宽；抽样像素颜色与图纸一致。
- [ ] 全透明/空设计给出提示且不产出损坏文件。

## 完成记录

（resolve 时填写）
