# 01 token 与动效基建

Status: ready-for-agent
Completion: not-started

## 范围

- `globals.css` `@theme` 新增：`--color-hairline / --color-hairline-strong / --color-surface / --color-surface-raised / --color-surface-sunken`、`--shadow-1/2/3 / --shadow-primary / --ring-focus / --ring-danger`、`--dur-press/fast/base/slow`、`--ease-out / --ease-spring`、`--field-*`（字段配方变量）。
- keyframes：`doupu-rise`（改 `--ease-out`）、`pop-in`、`modal-in`、`backdrop-in`、`heart-pop`、`count-roll`、`check-draw`、`spin`、`shimmer`。
- 工具类：`.stagger > *`、`.surface-card`、`.surface-sunken`、`.field-label`、`.form-row`、`.form-row-actions`、`.skeleton`。
- 新组件 `ui/Spinner.tsx`；`Button loading` 自动渲染 Spinner。

## 验收

- `npm run typecheck`、`npm run lint` 通过；`Button.test` 新增 loading 渲染 Spinner 断言。
