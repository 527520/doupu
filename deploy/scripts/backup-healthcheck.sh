#!/bin/sh
# Healthy only when a verified backup completed within the accepted RPO window.
set -eu

STATUS_FILE=${BACKUP_STATUS_FILE:-/tmp/backup-last-success}
MAX_AGE_SECONDS=${BACKUP_MAX_AGE_SECONDS:-129600}
test -s "${STATUS_FILE}"
last_success=$(cat "${STATUS_FILE}")
case "${last_success}" in
  ''|*[!0-9]*) exit 1 ;;
esac
now=$(date +%s)
age=$((now - last_success))
[ "${age}" -ge 0 ] && [ "${age}" -le "${MAX_AGE_SECONDS}" ]
