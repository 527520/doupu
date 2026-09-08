# 07 文案缩短

Status: ready-for-agent
Completion: complete

## 范围

按钮 ≤ 5 字，完整语义放 `title`；空态统一「先在左侧选择一项」句式；`allClear` 补标点；清空勾选处不再用「取消编辑」。每改一条同步 `tests/e2e` 与 `*.test.tsx` 中的 `getByRole(...name)`。

## 验收

- `rg` 旧文案在 `src` 与 `tests` 均为 0。
