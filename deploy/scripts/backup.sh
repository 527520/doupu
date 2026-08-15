#!/bin/sh
# 每日备份：pg_dump → gzip → 腾讯云 COS（rclone 官方支持 TencentCOS，签名由 rclone 处理）。
# 由 docker compose backup 服务每日调用；手动执行：docker compose exec backup /scripts/backup.sh
set -eu

STAMP=$(date +%Y%m%d-%H%M%S)
FILE="doupu-${STAMP}.sql.gz"
TMP="/tmp/${FILE}"

pg_dump --no-owner --no-privileges | gzip > "${TMP}"

if [ -z "${COS_SECRET_ID:-}" ] || [ -z "${COS_SECRET_KEY:-}" ] || [ -z "${COS_BUCKET:-}" ]; then
  echo "COS_* 未配置：跳过上传，备份保留于 ${TMP}（容器销毁即失，请尽快配置 COS）"
  exit 0
fi

rclone copyto "${TMP}" "doupucos:${COS_BUCKET}/doupu-backup/${FILE}"

rm -f "${TMP}"
echo "backup uploaded: doupu-backup/${FILE}"
