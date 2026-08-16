#!/bin/sh
# 备份失败告警（优化票 03）：POST 到应用内部告警端点（共享令牌鉴权），由应用转发邮件。
# 未配置令牌/端点时仅输出到容器日志（docker compose logs backup 可见）。
set -eu

MSG="$1"
if [ -z "${BACKUP_ALERT_TOKEN:-}" ] || [ -z "${ALERT_ENDPOINT:-}" ]; then
  echo "[alert] 未配置告警通道，失败信息仅记录日志: ${MSG}"
  exit 0
fi

curl -fsS -X POST "${ALERT_ENDPOINT}" \
  -H "Content-Type: application/json" \
  --data "{\"token\":\"${BACKUP_ALERT_TOKEN}\",\"message\":\"${MSG}\"}" >/dev/null 2>&1 \
  || echo "[alert] 告警发送失败（端点不可达）: ${MSG}"
