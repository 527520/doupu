# 15: 认证页面与邮件模板

- Status: resolved
- Blocked by: 14

## 完成记录

- 页面：`src/app/{login,register,verify-email,forgot-password,reset-password}/page.tsx`（全部 'use client'，noValidate + 自定义校验；登录 401/400/429 统一文案防枚举；注册 409 emailTaken + 400 字段级错误；验证页 token 来自 URL（Suspense 包裹 useSearchParams）+ 失败统一文案 + 重发 60s 冷却；找回页恒成功语义含网络失败分支 + 冷却；重置页成功提示旧会话失效）。
- 组件：`src/components/auth/{AuthShell,FormError}.tsx`；邮件模板 `src/lib/auth/mailTemplate.ts`（纯函数，文案单一来源 zhCN.auth）。
- 文案：`authPages:` 命名空间 24 键。
- 测试 24 例全绿：mailTemplate 3、login 5、register 5、verify-email 3、forgot-password 4、reset-password 4；覆盖 E28/E30/E31/E32 呈现与防枚举路径。
- 修复过程：jsdom 原生表单校验拦截 submit → 表单加 noValidate；标题/按钮文本歧义 → role 查询；validHours 未使用告警。
- 说明：全局 typecheck 现存 2 处错误在 T16 在途文件（db/client Database 导出重命名竞争），与本票无关。

## 目标

登录/注册/验证/找回/重置页面与邮件 HTML 模板。

## 范围

- 页面：/login、/register、/verify-email（结果态：成功/失效/过期 + 重发）、/forgot-password（恒成功提示）、/reset-password（令牌校验、密码设置、成功后强制重新登录提示）。
- 表单：客户端即时校验（邮箱格式、密码 8–72、两次一致）、错误文案映射（复用 T02 错误码与 T14 响应）、提交 loading、防重复提交。
- 邮件模板（HTML+纯文本回退）：验证邮件（链接+24h 有效期+品牌）、重置邮件（1h 有效期）；模板渲染函数 + 单测（链接含一次性令牌、文案完整）。
- 页头登录态（未登录显示登录/注册入口；已登录显示邮箱菜单）。

## 不含

- 设计列表/账号设置页（T17）。

## 规格引用

- spec §F9、§F11；边界 E28–E34（UI 呈现）。

## 验收标准

- [ ] 组件测试：各页面状态矩阵（成功/失效/过期/重发/提交中/防重复）。
- [ ] 模板测试：令牌注入、有效期文案、纯文本回退。
- [ ] 全页面无硬编码文案（走 messages 模块）。

## 完成记录

（resolve 时填写）
