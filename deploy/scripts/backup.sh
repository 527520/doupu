#!/bin/sh
# 每日备份：pg_dump → gzip → 腾讯云 COS（私有桶，30 天生命周期由桶策略清理）。
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

HOST="${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com"
KEY="doupu-backup/${FILE}"
NOW=$(date +%s)
EXPIRE=$((NOW + 600))
HTTP_DATE=$(date -u +"%a, %d %b %Y %H:%M:%S GMT")
CONTENT_TYPE="application/gzip"

# COS 签名（v5 header 鉴权，官方算法）：
# SignKey = Base64(HMAC-SHA1(SecretKey, KeyTime))；
# StringToSign = "sha1\n" + KeyTime + "\n" + hex(SHA1(HttpString)) + "\n"（header 值 URL 编码）；
# Signature = hex(HMAC-SHA1(SignKey 字符串, StringToSign))。
SIGN_TIME="${NOW};${EXPIRE}"
HTTP_HEADERS="content-type;host"
SIGN_KEY=$(printf "%s" "${COS_SECRET_KEY}" | openssl dgst -sha1 -hmac "${SIGN_TIME}" -binary | openssl base64)
HTTP_STR="put\n/${KEY}\n\ncontent-type=application%2Fgzip&host=${HOST}\n"
HTTP_SHA1=$(printf "%b" "${HTTP_STR}" | openssl dgst -sha1 -r | awk '{print $1}')
STRING_TO_SIGN="sha1\n${SIGN_TIME}\n${HTTP_SHA1}\n"
SIGNATURE=$(printf "%b" "${STRING_TO_SIGN}" | openssl dgst -sha1 -hmac "${SIGN_KEY}" -r | awk '{print $1}')
AUTH="q-sign-algorithm=sha1&q-ak=${COS_SECRET_ID}&q-sign-time=${SIGN_TIME}&q-key-time=${SIGN_TIME}&q-header-list=${HTTP_HEADERS}&q-url-param-list=&q-signature=${SIGNATURE}"

HTTP_CODE=$(curl -sS -o "${TMP}.resp" -w "%{http_code}" -X PUT \
  -H "Host: ${HOST}" \
  -H "Date: ${HTTP_DATE}" \
  -H "Content-Type: ${CONTENT_TYPE}" \
  -H "Authorization: ${AUTH}" \
  --data-binary "@${TMP}" \
  "https://${HOST}/${KEY}")

if [ "${HTTP_CODE}" != "200" ]; then
  echo "COS upload failed with HTTP ${HTTP_CODE}:" >&2
  cat "${TMP}.resp" >&2
  rm -f "${TMP}.resp" "${TMP}"
  exit 1
fi

rm -f "${TMP}.resp" "${TMP}"
echo "backup uploaded: ${KEY}"
