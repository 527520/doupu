#!/bin/sh
# Backup failures must have an operational alert channel in production.
set -eu

MSG=${1:?alert message is required}
if [ -z "${BACKUP_ALERT_TOKEN:-}" ] || [ -z "${ALERT_ENDPOINT:-}" ]; then
  echo "[alert] BACKUP_ALERT_TOKEN and ALERT_ENDPOINT are required" >&2
  exit 1
fi

PAYLOAD=$(jq -nc --arg token "${BACKUP_ALERT_TOKEN}" --arg message "${MSG}" \
  '{token: $token, message: $message}')
curl -fsS -X POST "${ALERT_ENDPOINT}" \
  -H "Content-Type: application/json" \
  --data-binary "${PAYLOAD}" >/dev/null

echo "[alert] delivered"
