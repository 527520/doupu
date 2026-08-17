#!/bin/sh
# Wait for production dependencies, run verified backups, and expose freshness.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WAIT_ATTEMPTS=${BACKUP_WAIT_ATTEMPTS:-120}
WAIT_SECONDS=${BACKUP_WAIT_SECONDS:-2}
INTERVAL_SECONDS=${BACKUP_INTERVAL_SECONDS:-86400}
STATUS_FILE=${BACKUP_STATUS_FILE:-/tmp/backup-last-success}
APP_HEALTH_ENDPOINT=${APP_HEALTH_ENDPOINT:-http://app:3000/}

abort_wait() {
  message=$1
  echo "backup prerequisite FAILED: ${message}" >&2
  "${SCRIPT_DIR}/notify.sh" "豆谱备份失败：${message}" \
    || echo "backup prerequisite alert delivery also failed" >&2
  exit 1
}

wait_for_postgres() {
  attempt=1
  while [ "${attempt}" -le "${WAIT_ATTEMPTS}" ]; do
    if pg_isready -h "${PGHOST:-postgres}" -U "${PGUSER:-doupu}" -d "${PGDATABASE:-doupu}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${WAIT_SECONDS}"
    attempt=$((attempt + 1))
  done
  abort_wait "PostgreSQL did not become ready"
}

wait_for_app() {
  attempt=1
  while [ "${attempt}" -le "${WAIT_ATTEMPTS}" ]; do
    if curl -fsS --max-time 5 "${APP_HEALTH_ENDPOINT}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${WAIT_SECONDS}"
    attempt=$((attempt + 1))
  done
  abort_wait "app did not become ready"
}

while true; do
  wait_for_postgres
  wait_for_app
  "${SCRIPT_DIR}/backup.sh"
  status_tmp="${STATUS_FILE}.tmp.$$"
  date +%s > "${status_tmp}"
  mv "${status_tmp}" "${STATUS_FILE}"
  echo "backup success timestamp updated: ${STATUS_FILE}"
  case "${BACKUP_RUN_ONCE:-false}" in
    true|1) exit 0 ;;
  esac
  sleep "${INTERVAL_SECONDS}"
done
