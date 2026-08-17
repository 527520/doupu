# 06 编辑完整性、色板托盘与重生成保护

Status: ready-for-human

Blocked by: 03, 04

## Outcome

快速拖动产生连续笔画，pointercancel 完整回滚；用户可搜索选择任何可用色；手工修补后重生成必须确认并保留可撤销旧快照。

## Tracer Bullet

从一次跨多个格子的 pointer stroke 开始，记录快照、插值应用、pointercancel 回滚，再验证重生成确认后的 undo。

## Implementation

- 使用网格线段遍历插值，不依赖 pointermove 命中每格。
- pointerdown 建立事务快照；pointercancel 回滚全部 cell 写入。
- 搜索色板托盘支持色号/名称/hex，选择色不要求先在画布吸取。
- session 记录 manual-dirty；regenerate 前确认，旧 committed pattern 进入 undo stack。

## Acceptance Tests

- 高速水平/对角/越界笔画无间隙；cancel 后数组字节级等于操作前。
- 选择未出现在图中的颜色并绘制成功。
- 重生成取消不改状态；确认后 undo 恢复全部手工修补。

## Files

`PixelEditorCanvas.tsx`、editor logic、palette tray、Workbench/session tests
