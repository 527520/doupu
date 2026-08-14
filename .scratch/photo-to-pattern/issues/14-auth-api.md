# 14: 认证 API（含会话、令牌、限流、邮件）

- Status: resolved

## 完成记录

- `src/lib/auth/`：db.ts（生产惰性单例 + 测试注入）、tokens.ts（32B base64url + sha256 hex，测试 4 例）、password.ts（argon2id 19456/2/1，测试 4 例）、cookies.ts（serialize/clear/parse/read，30 天 Max-Age）、session.ts（getSessionUserId 契约 + resolveSessionUserId 核心 + 滚动续期 + 全量失效）、rateLimit.ts（小时窗口 + incrementRateLimit）、mailer.ts（SES SMTP / dev console / sentMails 测试钩子 + 链接构造）、guard.ts（Origin 同源 + JSON Content-Type）、http.ts（readJson/apiError 统一错误体，ZodError→400 字段路径，未知→500 不泄露细节）。
- 路由 ×10：register/verify-email/resend-verification/login/logout/me/forgot-password/reset-password/change-password/account，全部按 spec §4.2 语义（防枚举恒 204、令牌一次性、重置后旧会话全失效、注销级联）。
- 测试：`src/app/api/auth/auth.test.ts` 全生命周期（注册→重复 409→未验证 me 403→验证→me 200→改密→找回/重置→旧会话失效→注销）+ 账号注销级联 + 重发防枚举 + 密码边界 E31 + 限流 429 E33 + CSRF/坏请求体 + 会话表仅存哈希；`tokens.test.ts`/`password.test.ts`。
- 边界覆盖：E28（重复注册/大小写）、E29（未验证 403）、E30（令牌过期/重用/伪造统一文案）、E31、E32、E33、E34。
- 测试尚未运行（按分工由父代理统一跑 vitest）；typecheck/lint 对本模块全绿。
- 遗留（非本票文件，需父代理协调）：`src/components/workbench/Workbench.tsx` 对 ImageCropper 用了默认导入（T07 交付的是命名导出），其 test 亦有 BlobPart 类型与未用参数问题——属 T12/T07 集成冲突。
- Blocked by: 13

## 目标

spec §4.2 认证端点全套实现 + 测试。

## 范围

- Route Handlers：register / verify-email / resend-verification / login / logout / me / forgot-password / reset-password / change-password / account。
- argon2id 哈希（ADR-0004 参数）；会话（32B 随机令牌、SHA-256 哈希存储、Cookie HttpOnly/SameSite=Lax/Secure、30 天滚动过期）；email_tokens（一次性、有效期 24h/1h）；找回密码后旧会话全失效；注销级联删除。
- 速率限制：register/login/resend/forgot 按 IP 与 email（10 次/小时），429 响应；防枚举（注册/忘记密码/重发恒 204 或统一文案）。
- SMTP 适配器接口：dev 用控制台输出（日志含链接，供 E2E 测试钩子读取）；prod 用腾讯云 SES SMTP（配置项在 .env）。
- zod 校验（复用 T02）；错误统一 `{error:{code,message}}`；密码策略 8–72。
- 测试：route handler + 真实 Postgres；邮件假实现。

## 不含

- 认证页面 UI（T15）。

## 规格引用

- spec §F9、§4.2；ADR-0004；边界 E28–E34。

## 验收标准

- [ ] 全部端点测试通过：注册→验证→登录→me→修改密码→找回→重置→旧会话失效→注销级联。
- [ ] 边界断言：重复注册（大小写）、未验证 403、令牌过期/重用/伪造、密码边界、429、恒响应防枚举。
- [ ] Cookie 属性断言（HttpOnly/SameSite/Secure）；会话表只存哈希。
- [ ] 错误响应不含内部细节（无堆栈/SQL）。

## 完成记录

（resolve 时填写）
