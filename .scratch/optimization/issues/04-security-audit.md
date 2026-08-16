# 04 攻击者视角安全自查

Status: ready-for-agent

## 目标

对生产形态（Caddy + Docker + PostgreSQL + 开放注册）做一轮渗透式自查，覆盖：

1. 认证与会话：登录时序、验证/重置令牌、会话续期、Cookie 属性、注销/销户后的会话残留。
2. 授权：全部 API 的所有权校验（designs/palettes/account/change-password）、未验证邮箱边界、直链打开边界。
3. 输入与注入：全部路由的 zod 校验完整性、SQL 参数化、文件名/路径、JSON 深度。
4. CSRF/Origin：enforceMutatingGuard 覆盖度与绕过面（含 bodyless 变更请求、content-type 大小写）。
5. 同步协议：客户端时钟、LWW 边界、墓碑传播、项目文件体积与内容上限的服务端再校验。
6. 部署面：Caddy 头、docker 配置、备份密钥面、环境变量泄露面、错误响应信息泄露。
7. 依赖：package.json 各依赖当前版本是否有已知高危（离线常识判断 + 若可联网则查证）。

## 输出

发现清单（严重/中/轻 + 复现 + 修法）→ 逐条修复 → 每条补回归测试（单测或 E2E）。修复标准：不改已确认正确的业务语义。

## 验收

- 自查报告归档到本票 Comments；全部发现修复并测试通过；全量回归绿。

## 涉及文件

src/lib/auth/**、src/app/api/**、src/lib/sync/**、db/schema.ts、Caddyfile、docker-compose.prod.yml、deploy/**
