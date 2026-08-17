# 备份恢复与定期演练

备份不再是 SQL 管道的“命令成功”，而是 custom-format dump 经 `pg_restore --list` 校验、压缩、上传临时 key、字节数校验和原子 promote 后才算成功。任一阶段失败都返回非零并调用告警链。

## 自动恢复演练

从 COS 下载最新的 `doupu-YYYYMMDD-HHMMSS.dump.gz`，在备份容器中执行：

```bash
docker compose -f docker-compose.prod.yml run --rm \
  -e RESTORE_DATABASE=doupu_restore_test \
  backup /scripts/restore-drill.sh /backup/doupu-YYYYMMDD-HHMMSS.dump.gz
```

`RESTORE_DATABASE` 必须以 `_restore_test` 结尾，脚本会先校验 dump manifest，再创建隔离数据库并完整 restore。可用 `RESTORE_CANARY_SQL` 指定必须返回非空结果的 canary 查询。CI 对每次改动执行临时备份闭环；`.github/workflows/production-backup-restore.yml` 每月只接受 36 小时内最新 promote 的生产归档，在隔离 PostgreSQL 16 中完整恢复并检查核心 `users` 表。缺少 COS secrets、没有新鲜归档、下载/校验/恢复任一步失败都会让定时任务失败并进入 GitHub Actions 告警面板。

## 灾难恢复

1. 停止 Caddy 和 app，保留 PostgreSQL：`docker compose -f docker-compose.prod.yml stop caddy app`。
2. 对现场库再做一份 dump，禁止直接覆盖唯一数据。
3. `gzip -dc` 解压并以 `pg_restore --list` 校验。
4. 在新数据库中 restore，检查 users/designs/palettes 数量和 canary。
5. 更新 `DATABASE_URL`，执行迁移和健康检查，最后恢复 Caddy 流量。

不要在未完成隔离 restore 校验时向生产库执行 `--clean` 或 drop。
