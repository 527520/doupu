# 01 可信质量基线与跨平台 E2E

Status: ready-for-human

## Outcome

coverage、database integration、performance 成为独立且可重复的质量门禁；Argon2 原生测试串行；Playwright 快捷键、进程树清理和浏览器安装预检跨平台正确。

## Tracer Bullet

从一个跨平台 Workbench E2E 用例贯穿测试脚本、CI job、dev server 生命周期和浏览器预检，证明门禁能在 macOS/Linux 分别稳定退出。

## Implementation

- 拆分 npm scripts 与 Vitest projects，性能测试不得受 coverage instrumentation 影响。
- 将 Argon2/大 DOM 场景放入串行 project，并使用基于实测的独立 timeout。
- 快捷键统一使用 `ControlOrMeta`；teardown 按平台终止进程树并验证 3100 端口释放。
- CI 在运行 E2E 前明确安装/验证 Chromium、Firefox、WebKit。

## Acceptance Tests

- coverage 与 performance 各连续 5 次通过；Argon2 无 N-API crash。
- macOS/Linux 快捷键分支有单测或 runner 证据；teardown 后端口不可连接。
- 缺少浏览器时门禁在测试前给出明确错误而不是执行中失败。

## Files

`package.json`、Vitest config、`playwright.config.mts`、`tests/e2e/*`、`.github/workflows/*`
