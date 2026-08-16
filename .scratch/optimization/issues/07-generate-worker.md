# 07 生成 Web Worker 化 + 进度 + 取消

Status: done

## Comments（2026-08 实施记录）

- 实现：`src/lib/engine/runGenerate.ts`（任务句柄 `{ promise, cancel }`，无 Worker 环境同步回退，Worker 异常回退主线程同步执行一次并 `console.error` 记录）+ `generate.worker.ts`（协议：progress/done/error）。
- 进度：`generatePattern` 增加可选 `onProgress` 按管线 8 阶段上报（5→100 单调）；工作台 >300ms 才显示进度条（固定宽度槽位，避免「取消」按钮位移导致误点），快速任务直接出结果。
- 取消：工作台 token + `task.cancel()`（terminate Worker）；重启/导入/卸载同样终止在途任务。
- 单测：`runGenerate.test.ts`（8：回退/进度/错误回退/取消/迟到消息）+ `generate.worker.test.ts`（2：协议直测）+ Workbench 既有流程用例全绿。
- E2E：`02-workbench-journey` 增加「200×200 生成期间输入框可交互 + 取消按钮可点」「大图生成中改参数 → 最终结果与最后一次参数一致」断言（3 浏览器）。
- 注意：E2E 首轮发现进度条替换文本导致「取消」按钮位置跳动、点击被 `<html>` 拦截（firefox）→ 状态区改为固定宽度槽位解决。
- **重大发现（Firefox 崩溃）**：E2E 三浏览器回归时 Firefox 出现多种诡异失败（取消按钮不出现/点击被拦截/悬停提示消失），逐层诊断（trace 解析 + 最小复现）定位到：**webpack 模块 worker 在任务执行中调用 `terminate()` 会直接崩溃 Firefox 页面**（blob worker 与「完成后 terminate」均无此问题）。修复：取消改为「丢弃语义」——cancel() 立即以 AbortError 拒绝、断开引用，Worker 自然跑完后在 done/error 处理器中自行销毁（迟到结果被 settle 守卫丢弃）；注释记录了原因。E2E 参数输入也改用真实键盘键入（typeSpin：Ctrl+A + 逐字输入），规避 Firefox 下 Playwright fill 对受控输入偶发不触发 React onChange 的问题。

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
