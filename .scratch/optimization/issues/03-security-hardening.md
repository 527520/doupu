# 03 安全加固四件套

Status: ready-for-agent

## 目标

1. **CSP 收窄**（盘点 #24）：`Caddyfile` 的 `script-src 'unsafe-inline'` 改为 nonce 方案。实施前提验证：Next.js 15 App Router 注入 nonce 到 RSC 内联脚本的可行性（middleware headers + 自定义 script 标签 nonce）。**若验证不可行**：保留现状并在此票内记录结论与理由，票仍算完成（防阻塞），结论写入 docs/adr。
2. **备份失败告警**（#25）：`deploy/scripts/backup.sh` 上传后校验 rclone 退出码；失败时通过邮件接口告警（复用 SMTP 配置，未配置 SMTP 时在容器日志输出显著标记）；成功后写时间戳到备份目录。`docker-compose.prod.yml` backup 服务加 restart 策略与失败可见性说明。
3. **限流表清理**（#26）：`db/schema.ts` 无迁移变更；在 app 启动 instrumentation 加每日一次清理任务（删除窗口起始早于当前小时的旧行，保留最近 N 天）；E2E/开发不执行（生产限定），并补单测（纯函数清理 SQL 生成或直接对测试库执行）。
4. **backup 容器固化**（#27）：新建 `deploy/Dockerfile.backup`（postgres:16-alpine + rclone 预装），compose 的 backup 服务改用该镜像，去掉每次启动 `apk add`。

## 验收

- CSP：若实施 nonce，生产构建 + 页面加载无 CSP 报错（E2E 回归）；若未实施，ADR 记录结论。
- 备份：手动执行 backup.sh 成功/失败两路径验证（失败时告警路径被调用）。
- 限流清理：单测验证旧行被删、新行保留；E2E 不受影响。
- 容器固化：`docker compose config` 校验通过（不实际起生产容器）。

## 涉及文件

Caddyfile、deploy/scripts/backup.sh、deploy/Dockerfile.backup（新）、docker-compose.prod.yml、src/instrumentation.ts、db/client.ts、docs/adr/（如需要）
