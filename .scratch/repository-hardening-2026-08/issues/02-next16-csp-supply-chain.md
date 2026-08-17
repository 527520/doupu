# 02 Next.js 16、严格 CSP 与供应链门禁

Status: ready-for-human

Blocked by: 01

## Outcome

应用只运行于 Next.js 16 原生路径，使用 ESLint CLI、默认 Turbopack 和官方 nonce CSP；生产依赖 audit 为零 critical/high。

## Tracer Bullet

让首页请求生成 nonce，贯穿 CSP header、Next framework/RSC script 和浏览器 E2E，再以生产 build/standalone 验证无 `unsafe-inline`。

## Implementation

- 升级 Next.js/eslint-config-next 与必要依赖，移除 `next lint` 和旧 bundler 兼容配置。
- 通过 Proxy/middleware 生成 nonce 并传递官方请求 header；所有页面接受动态渲染。
- 新增 ADR supersede ADR-0007；同步 Caddy/header 配置。
- official npm registry 的生产依赖 audit 进入 CI；处理 Drizzle/esbuild 工具链风险。

## Acceptance Tests

- lint、typecheck、production build、standalone smoke 全绿。
- 浏览器读取 CSP 不包含 script `unsafe-inline`，RSC/导航/Worker 正常。
- `npm audit --omit=dev --registry=https://registry.npmjs.org` 为 0 critical/high。

## Files

`package.json`、lockfile、Next/ESLint config、Proxy/middleware、Caddyfile、`docs/adr/`
