# 备份恢复演练（ADR-0005，spec §9 交付物）

> 目标：验证「每日 pg_dump → COS」的备份可以真正恢复业务数据。建议每季度演练一次。

## 1. 获取备份文件

- 登录腾讯云 COS 控制台 → 桶 `COS_BUCKET` → `doupu-backup/` 目录，下载最近的 `doupu-YYYYMMDD-HHMMSS.sql.gz`。

## 2. 恢复到临时库（演练，不触碰生产库）

```bash
# 在服务器上
gunzip -k doupu-YYYYMMDD-HHMMSS.sql.gz
docker compose -f docker-compose.prod.yml exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -U doupu -d postgres -c "CREATE DATABASE doupu_restore_test;"
docker compose -f docker-compose.prod.yml exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -U doupu -d doupu_restore_test < doupu-YYYYMMDD-HHMMSS.sql
```

## 3. 校验

```sql
-- 表结构完整
SELECT count(*) FROM users;
SELECT count(*) FROM designs;
SELECT count(*) FROM palettes;
```

- 抽查 1 个用户的 designs 列表与生产 UI 显示一致（数量、updated_at 排序）。
- 抽查 1 个 design 的 project JSON 可被导入工作台（项目文件格式无损）。

## 4. 清理

```bash
docker compose -f docker-compose.prod.yml exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -U doupu -d postgres -c "DROP DATABASE doupu_restore_test;"
rm doupu-YYYYMMDD-HHMMSS.sql
```

## 恢复生产库（仅在真实灾难时）

1. 停服：`docker compose -f docker-compose.prod.yml stop app`
2. 用第 2 步命令把 dump 导入 **doupu** 库（覆盖前先 `pg_dump` 留现场快照）。
3. 起服：`docker compose -f docker-compose.prod.yml up -d`
4. 验证首页可访问、登录可用、设计列表完整。
