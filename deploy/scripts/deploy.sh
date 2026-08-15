#!/bin/bash
# 服务器端部署脚本（ADR-0005）：在已克隆仓库的服务器上执行。
# 用法：bash deploy/scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -f .env ]; then
  echo "缺少 .env：请 cp .env.example .env 并填写全部变量后重试" >&2
  exit 1
fi

echo "==> 构建并启动服务（--force-recreate：确保 .env/源码变更必定生效）"
docker compose -f docker-compose.prod.yml up -d --build --force-recreate

echo "==> 等待 postgres 就绪"
for i in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U "${POSTGRES_USER:-doupu}" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> 执行数据库迁移（幂等）"
docker compose -f docker-compose.prod.yml exec -T app node db/migrate.cjs

echo "==> 健康检查"
docker compose -f docker-compose.prod.yml ps
