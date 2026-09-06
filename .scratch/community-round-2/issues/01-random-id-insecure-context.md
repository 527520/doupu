# 01 局域网 HTTP 下选图无响应：客户端 UUID 兜底

Status: ready-for-human
Completion: complete

## 问题

通过 `http://192.168.x.x:3000` 访问时浏览器不暴露 `crypto.randomUUID`，官方批量 `selectFiles` 等客户端代码直接调用它，在状态更新前抛 TypeError，页面无反应无报错。

## 交付

- `src/lib/ids.ts` `randomId()`：优先 `randomUUID`，否则用 `getRandomValues` 拼 RFC 4122 v4；无 crypto 时退化为 Math.random。
- 替换所有浏览器侧调用（batchSession、useAdminCommand、CommunityInteractions、CommunitySubmitForm、CommunityMineActions、analytics/client、storage、sync/clientAdapter、palettes/api）。
- ESLint `no-restricted-properties` 禁止 `src/components/**` 与客户端 lib 直接用 `crypto.randomUUID`。
- 单测 `src/lib/ids.test.ts`。
