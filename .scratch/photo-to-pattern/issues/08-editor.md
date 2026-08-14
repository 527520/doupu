# 08: 像素编辑器

- Status: resolved

## 完成记录

- `src/lib/editor/`：ops.ts（brushBounds/applyBrush/applyErase/floodFill/replaceByCode/clearAll，全部快照式、格子对象只整槽替换；油漆桶按「同状态」四连通泛洪 E22；替换按色号幂等 E23）、history.ts（EditHistory 快照栈，100 步丢最旧、新操作清重做栈 E21）、state.ts（createEditorState 拷贝 cells、commitSnapshots、refreshStats 复用引擎 computeStats、undo/redo 联动统计）。
- `src/components/editor/`：EditorToolbar（工具/尺寸/撤销重做/替换/清除，aria-pressed）、PixelEditorCanvas（ref 式命令编辑 + 版本重绘；触屏点按落笔/500ms 长按吸色；鼠标按下即绘、拖动画线成单历史条目；B/E/G/I 与 Ctrl+Z/Y、方向键光标、回车落笔；替换面板含「排除颜色」与命中/未命中提示）。
- `src/messages/zh-CN.ts` 追加 editor 命名空间（定点编辑）。
- 测试：ops 14 例（含 200×200 泛洪 <50ms）、history 7 例（100 步丢最旧链式快照验证）、state 7 例（E21/E23/E24、统计联动、五操作性能探针）、EditorToolbar 6 例、PixelEditorCanvas 9 例（含触屏长按/点按、快捷键、替换、清除撤销）。typecheck/lint 全绿（vitest 由父代理运行）。
- Blocked by: 06

## 目标

生成图纸的像素级编辑：五工具 + 撤销重做 + 快捷键 + 触屏 + 统计联动。

## 范围

- 工具：画笔（1×1/2×2/3×3）、橡皮（置透明）、油漆桶（连通区域，同状态格）、吸管、全局替换（色号 A→B；「排除颜色」=替换为透明）、清除全部。
- 撤销/重做：快照式操作栈（记录受影响格前后值），上限 100 步丢最旧；生成/换参/换图清栈。
- 快捷键：B/E/G/I、Ctrl+Z / Ctrl+Shift+Z（macOS 对应 Cmd）；方向键移动选区（基础）。
- 触屏：点按绘制、长按吸色。
- 编辑操作 → 用量统计实时重算（复用 T05 `computeStats`）。
- 单操作延迟 ≤50 ms（200×200）。

## 不含

- 选区/图层/对称绘制（上游 PRD 的进阶项，不在本产品范围）。

## 规格引用

- spec §F5、§7.3（键盘）；边界 E21–E24。

## 验收标准

- [ ] 单测：撤销栈（空/顶/100 溢出）、重做、快照正确性；油漆桶连通性（E22）；全局替换（E23 幂等/不存在色号）；全透明后统计为 0（E24）。
- [ ] 组件测试：工具切换、快捷键、触屏事件映射。
- [ ] 性能：200×200 单操作 <50 ms（探针）。
- [ ] 覆盖率 ≥90%（纯逻辑部分）。

## 完成记录

（resolve 时填写）
