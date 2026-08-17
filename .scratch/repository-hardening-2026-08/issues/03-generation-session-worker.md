# 03 深生成会话 module 与可取消持久 Worker

Status: ready-for-human

Blocked by: 01, 02

## Outcome

源图、草稿参数、已提交快照、任务与错误由一个深 module 拥有；只有最新任务能提交；取消真停止计算并回滚草稿；生成中不能保存或导出。

## Tracer Bullet

用 fake Worker adapter 驱动 `ready → generating → committed`，再覆盖快速二次生成和 cancel，最后接入 Workbench 一个完整用户旅程。

## Interface

状态固定为 `no-source / ready / generating / committed / failed / restored-locked`；公开动作限定为 upload、restore、updateDraft、generate、cancel、commitManualEdit、reupload。

## Implementation

- 持久 Worker 复用 LUT/源图，只执行最新 job；算法循环提供协作取消检查点。
- 取消后 100ms 内停止进度与工作；late done/error 不提交、不 fallback 主线程。
- committed snapshot 同时拥有 params、palette、pattern 和 engineVersion。
- Workbench 删除分散的 task/token/source consistency 逻辑，保存/导出只读 snapshot。

## Acceptance Tests

- session interface 覆盖全部状态、乱序、错误分类、取消回滚和 unmount。
- 连发 N 个任务只提交最新；取消后无进度、无同步重跑、无旧任务 CPU 工作。
- 生成中保存/导出控件禁用且业务入口拒绝。

## Files

`src/lib/engine/session/*`、`runGenerate.ts`、worker、`Workbench.tsx`
