# 07 生成 Web Worker 化 + 进度 + 取消

Status: ready-for-agent

## 目标（spec F3 欠账）

`generatePattern` 同步执行冻结页面 1-3 秒、无法取消。要求：

1. 生成移到 Web Worker：`generatePattern` 保持同步纯函数（单测不变），新增 worker 入口（Vite/Next 兼容方式：`new Worker(new URL('./generate.worker.ts', import.meta.url))` 或 Next 支持的封装）。
2. 进度：按行/按阶段上报（0→100%），工作台显示进度条或百分比；快速任务（<300ms）不显示进度直接出结果。
3. 取消：生成中再次改参数/切换色板/重新上传 → 丢弃旧任务结果（版本号或 token 防旧结果覆盖新结果）。
4. 失败：worker 异常回退主线程同步执行一次（保底），并记录日志。

## 边界

- jsdom 单测继续用同步 `generatePattern`（性能预算测试不变）。
- Worker 内数据传递：像素缓冲（Uint8ClampedArray 可转移）与色板序列化；200×200 数据量可控。
- Safari 兼容：Modern Web Worker 均支持。

## 验收

- 单测：取消/乱序结果丢弃逻辑（用可控 mock worker 或纯函数化调度器）；性能预算测试仍绿。
- E2E：改宽度 20 → 立即再改 100 → 最终结果与最后一次参数一致（乱序防护）；生成 200×200 时页面可点击（不冻结，可点击取消/切换页签）。
- 全量回归。

## 涉及文件

src/lib/engine/generate.ts、src/lib/engine/generate.worker.ts（新）、src/components/workbench/Workbench.tsx、src/messages/zh-CN.ts
