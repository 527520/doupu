#!/bin/sh
# Verified nightly backup: dump -> validate -> compress -> pending upload -> promote.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="doupu-${STAMP}.dump.gz"
WORK_DIR=$(mktemp -d)
RAW="${WORK_DIR}/doupu-${STAMP}.dump"
MANIFEST="${WORK_DIR}/doupu-${STAMP}.list"
ARCHIVE="${WORK_DIR}/${FILE}"
REMOTE_DIR=${BACKUP_DESTINATION:-"doupucos:${COS_BUCKET:-}/doupu-backup"}
PENDING="${REMOTE_DIR}/.pending/${FILE}"
FINAL="${REMOTE_DIR}/${FILE}"

cleanup() {
  rm -rf -- "${WORK_DIR}"
}
trap cleanup EXIT HUP INT TERM

fail() {
  message=$1
  echo "backup FAILED: ${message}" >&2
  "${SCRIPT_DIR}/notify.sh" "豆谱备份失败：${message}" || echo "backup alert delivery also failed" >&2
  exit 1
}

if [ -z "${BACKUP_DESTINATION:-}" ] && { [ -z "${COS_SECRET_ID:-}" ] || [ -z "${COS_SECRET_KEY:-}" ] || [ -z "${COS_BUCKET:-}" ] || [ -z "${COS_REGION:-}" ]; }; then
  fail "COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION must all be configured"
fi

pg_dump --format=custom --no-owner --no-privileges --file "${RAW}" \
  || fail "pg_dump failed"
test -s "${RAW}" || fail "pg_dump produced an empty file"

pg_restore --list "${RAW}" > "${MANIFEST}" \
  || fail "pg_restore validation failed"
test -s "${MANIFEST}" || fail "pg_restore manifest is empty"

gzip -c "${RAW}" > "${ARCHIVE}" \
  || fail "compression failed"
test -s "${ARCHIVE}" || fail "compressed archive is empty"

rclone copyto "${ARCHIVE}" "${PENDING}" \
  || fail "pending upload failed for ${FILE}"

LOCAL_BYTES=$(wc -c < "${ARCHIVE}" | tr -d ' ')
REMOTE_LIST=$(rclone lsl "${PENDING}") \
  || fail "pending object inspection failed for ${FILE}"
REMOTE_BYTES=$(printf '%s\n' "${REMOTE_LIST}" | awk 'NR == 1 { print $1 }')
if [ -z "${REMOTE_BYTES}" ] || [ "${REMOTE_BYTES}" != "${LOCAL_BYTES}" ]; then
  fail "pending object size mismatch for ${FILE}"
fi

rclone moveto "${PENDING}" "${FINAL}" \
  || fail "atomic promote failed for ${FILE}"
FINAL_LIST=$(rclone lsl "${FINAL}") \
  || fail "promoted object inspection failed for ${FILE}"
FINAL_BYTES=$(printf '%s\n' "${FINAL_LIST}" | awk 'NR == 1 { print $1 }')
if [ -z "${FINAL_BYTES}" ] || [ "${FINAL_BYTES}" != "${LOCAL_BYTES}" ]; then
  fail "promoted object verification failed for ${FILE}"
fi

echo "backup verified and promoted: doupu-backup/${FILE} (${LOCAL_BYTES} bytes)"
