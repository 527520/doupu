# 21: 部署与交付

- Status: resolved
- Blocked by: 20

## 完成记录

- 已交付：`Dockerfile`（standalone 多阶段、非 root、健康检查）、`docker-compose.prod.yml`（app/postgres/caddy/每日备份）、`Caddyfile`（自动 TLS + 安全头）、`deploy/scripts/{deploy.sh,backup.sh}`（COS v5 签名备份）、`deploy/restore.md`（恢复演练）、`deploy/CHECKLIST.md`（购机/域名/个人 ICP 备案/SES/COS 全流程）、`.env.example`、`README.md`、`next.config.ts`（standalone）、`db/migrate.cjs`（容器内迁移入口）、`.github/workflows/{ci.yml,release.yml}`（含三浏览器 E2E 门禁与 tag→GHCR 镜像）。
- 已验证：standalone 服务器本地冒烟（/、/app、字体资产 200）；E2E 27/27（三浏览器）；单元 429/429；lint/typecheck/build 全绿。
- ✅ **已开源发布**：仓库 https://github.com/527520/doupu（Public，AGPL-3.0），`main` 已推送（24+ 提交）。
- **移交用户的最后一步（检查单已逐步指引）**：`deploy/CHECKLIST.md` 第 1–8 步：购机/域名/备案/DNS/SES/COS → 服务器上 `bash deploy/scripts/deploy.sh`。Docker 冒烟与备份恢复演练需 Docker 主机（本沙箱无 Docker），按 `deploy/restore.md` 在服务器上执行。

## 目标

生产部署全套：镜像、compose、Caddy、备份、部署/备案检查单、README、开源合规页面。

## 范围

- Dockerfile：Next.js standalone 多阶段构建（node:20-alpine）；非 root 运行；健康检查。
- docker-compose.prod.yml：app + postgres（持久卷）+ caddy + backup 边车（cron：每日 pg_dump → 腾讯云 COS，30 天保留）；`.env.example` 完整变量清单（DB/SESSION/SMTP/COS/站点地址）。
- Caddyfile：TLS 自动签发（HTTP-01）、HTTP→HTTPS、安全头（HSTS/X-Content-Type-Options/CSP 基线）、代理。
- deploy/：build.sh（构建镜像→推 GHCR）、deploy.sh（服务器拉取+迁移+重启）、restore.md（备份恢复演练步骤）、CHECKLIST.md（腾讯云购机/域名注册与实名/个人 ICP 备案全流程/解析/SES 开通/COS 桶/上线验收清单）。
- README.md：项目介绍、功能、截图位、快速开始（开发）、测试、部署、许可证（AGPL-3.0）、致谢上游；CONTRIBUTING 简版。
- /about 与页脚：开源声明、源码链接（github.com/527520/doupu）、备案号占位（上线填入）、隐私政策。
- GitHub Actions：release 工作流（tag → 构建镜像 → GHCR）。

## 不含

- 实际购机/备案（人类步骤，由检查单覆盖）；监控告警（可选增强，不做）。

## 规格引用

- spec §7.4、§9、§10；ADR-0005。

## 验收标准

- [ ] 本地 `docker compose -f docker-compose.prod.yml up` 冒烟通过（E2E 冒烟子集 + 健康检查）。
- [ ] 备份脚本真实运行一次并验证可从 dump 恢复（restore 演练记录）。
- [ ] CHECKLIST 逐步可执行、无歧义（含备案材料清单与常见被驳回原因）。
- [ ] README 覆盖用户/开发者/部署三种视角。
- [ ] 仓库 tag 触发 CI 镜像构建成功。

## 完成记录

（resolve 时填写）
