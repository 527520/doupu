#!/bin/sh
# 每日备份：pg_dump → gzip → 腾讯云 COS（rclone 官方支持 TencentCOS，签名由 rclone 处理）。
# 失败告警（优化票 03）：上传失败或远端校验不通过时调用 notify.sh 通知管理员。
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

if ! rclone copyto "${TMP}" "doupucos:${COS_BUCKET}/doupu-backup/${FILE}"; then
  echo "backup upload FAILED: rclone 退出码非 0"
  /scripts/notify.sh "豆谱备份失败：${FILE} 上传 COS 失败"
  exit 1
fi

# 远端存在性校验：防「命令成功但对象未真正落盘」的静默失败
if ! rclone lsf "doupucos:${COS_BUCKET}/doupu-backup/${FILE}" | grep -q "${FILE}"; then
  echo "backup verify FAILED: 远端未找到 ${FILE}"
  /scripts/notify.sh "豆谱备份失败：远端校验不通过 ${FILE}"
  exit 1
fi

rm -f "${TMP}"
echo "backup uploaded: doupu-backup/${FILE}"
