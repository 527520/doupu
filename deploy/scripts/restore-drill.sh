#!/bin/sh
# Restore a custom-format backup into an explicitly disposable drill database.
set -eu

ARCHIVE=${1:?usage: restore-drill.sh /path/to/doupu-*.dump.gz}
RESTORE_DATABASE=${RESTORE_DATABASE:-doupu_restore_test}
case "${RESTORE_DATABASE}" in
  *_restore_test) ;;
  *)
    echo "RESTORE_DATABASE must end with _restore_test" >&2
    exit 1
    ;;
esac
test -s "${ARCHIVE}" || { echo "backup archive is missing or empty" >&2; exit 1; }

WORK_DIR=$(mktemp -d)
RAW="${WORK_DIR}/restore.dump"
cleanup() { rm -rf -- "${WORK_DIR}"; }
trap cleanup EXIT HUP INT TERM

gzip -dc "${ARCHIVE}" > "${RAW}"
pg_restore --list "${RAW}" >/dev/null

dropdb --if-exists "${RESTORE_DATABASE}"
createdb "${RESTORE_DATABASE}"
pg_restore --no-owner --no-privileges --dbname "${RESTORE_DATABASE}" "${RAW}"

if [ -n "${RESTORE_CANARY_SQL:-}" ]; then
  psql --dbname "${RESTORE_DATABASE}" --set ON_ERROR_STOP=1 --tuples-only \
    --command "${RESTORE_CANARY_SQL}" | grep -q '[^[:space:]]'
fi

echo "restore drill verified: ${RESTORE_DATABASE}"
