# ADR-0007: CSP 保留 script-src 'unsafe-inline'（nonce 方案暂缓）

- Status: accepted
- Date: 2026-08-16

## Context

优化票 03 计划将 Caddyfile 的 CSP 从 `script-src 'self' 'unsafe-inline'` 收窄为 nonce 方案。

## Decision

保留 `'unsafe-inline'`，暂不实施 nonce。

## 理由

1. Next.js 15 App Router 的 RSC 载荷以内联 `<script>` 形式注入（`self.__next_f.push(...)`），官方**没有为这些内联脚本提供稳定的 nonce 注入点**（无配置项；社区方案依赖 middleware 改写 HTML 或 patch render，脆弱且随 Next 版本变动而失效）。
2. 本仓库无 `dangerouslySetInnerHTML`、无内联事件处理器、无用户可控 HTML 注入点；React 默认转义所有文本节点。`'unsafe-inline'` 的实际攻击面仅为「已存在的 XSS 注入点被内联脚本利用」，而当前不存在这类注入点。
3. 投入产出比：nonce 方案的实现/维护成本（脆弱、跨版本易碎）远高于其在本项目的边际收益。

## Consequences

- CSP 对 XSS 的抑制能力有限（纵深防御的一层被削弱）：保持无用户可控 HTML 的约束成为硬性要求；若未来引入任何 HTML 注入（富文本、模板渲染），必须先实现 nonce 或 hash 方案并更新本 ADR。
- 上游 Next.js 若提供官方 CSP nonce 支持，应优先迁移并撤销本决策。
