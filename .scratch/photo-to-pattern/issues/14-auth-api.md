# 14: 认证 API（含会话、令牌、限流、邮件）

- Status: open
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
