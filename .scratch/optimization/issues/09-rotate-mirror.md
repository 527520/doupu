# 09 编辑器镜像/旋转工具

Status: ready-for-agent

## 目标

新增四个纯函数变换（`src/lib/editor/ops.ts`，走既有快照/撤销模式）：

1. 左右翻转（水平镜像）
2. 上下翻转（垂直镜像）
3. 顺时针旋转 90°
4. 逆时针旋转 90°

工具栏新增「翻转/旋转」按钮组（旋转 ↻/↺ + 水平/垂直翻转），全部可撤销（EditHistory 单快照，与清除同级）。

## 边界

- 200×200 上限内原地变换 cells 数组（新数组，不改输入）；透明/外部格标志随格迁移。
- 旋转后 W/H 对调（Pattern width/height 变化）：编辑器 stateRef 与 stats 全量刷新，画布尺寸随之变化（复用现有外部变更重置路径的调用）。
- 与撤销/重做/清除/替换的组合顺序正确（快照记录完整前状态）。

## 验收

- 单测：四种变换在 2×3/3×3/1×1 图纸上的精确结果（含色号/透明格）、撤销恢复、统计不变性（豆子总数不变）。
- E2E：编辑页点击旋转 → 图纸宽高互换、撤销恢复（三浏览器）。
- 全量回归。

## 涉及文件

src/lib/editor/ops.ts、src/lib/editor/ops.test.ts、src/components/editor/EditorToolbar.tsx、src/components/editor/PixelEditorCanvas.tsx、src/messages/zh-CN.ts
