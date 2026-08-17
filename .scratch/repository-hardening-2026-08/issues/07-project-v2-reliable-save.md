# 07 ProjectFile v2、恢复锁定与可靠离开

Status: ready-for-human

Blocked by: 03, 06

## Outcome

项目文件只写一致的 v2 committed snapshot 并包含 `engineVersion`；v1 可导入迁移；没有原图的恢复/导入锁定重生成；站内离开先保存，失败才确认。

## Tracer Bullet

导入一个 v1 fixture，迁移为 restored-locked，验证参数控件不可改、导出仍读取原提交态；重新上传后解锁，并只导出 v2。

## Implementation

- v2 schema 保持 params/palette/pattern 一致且不含 source。
- parser 支持 v1→v2 内存迁移；serializer 只输出 v2。
- 恢复/导入进入 restored-locked，显示重新上传入口。
- dirty 状态即时可见；站内 Link/重新上传统一经过 async save guard。

## Acceptance Tests

- v1 fixtures 导入成功，下一次导出严格 v2；非法混代数据拒绝。
- 恢复后调参/换色板不可造成声明与 pattern 不一致。
- SPA 导航/重新上传等待保存；失败时确认留下/离开，成功时无弹窗。

## Files

project schemas/parser、storage、Workbench、navigation guard、messages
