# 21: 部署与交付

- Status: open
- Blocked by: 20

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
