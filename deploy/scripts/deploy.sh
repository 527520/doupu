#!/bin/bash
# Migration-first, health-checked short-maintenance cutover.
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE=(docker compose -f docker-compose.prod.yml)
restore_caddy_on_exit=false

# 停流后的协议终检尚未通过时，数据库仍完全未迁移，可以安全恢复原入口。
# 一旦开始迁移便关闭恢复开关：单向迁移后绝不把旧协议应用重新暴露出去。
restore_caddy_before_migration() {
  local status=$?
  trap - EXIT
  if [[ "${status}" -ne 0 && "${restore_caddy_on_exit}" == true ]]; then
    if "${COMPOSE[@]}" up -d --no-deps caddy; then
      echo "停流后的协议终检失败；已恢复 Caddy，数据库未迁移、应用未替换" >&2
    else
      echo "停流后的协议终检失败，且 Caddy 恢复失败；请立即人工检查入口" >&2
    fi
  fi
  exit "${status}"
}
trap restore_caddy_before_migration EXIT

if [[ ! -f .env ]]; then
  echo "缺少 .env：请 cp .env.example .env 并填写全部变量后重试" >&2
  exit 1
fi

# 生产部署只能消费 release workflow 产出的稳定 GHCR tag 或不可变 digest。
# 不 source .env（避免执行其中内容）；读取并导出已验证的单一值供 compose 覆盖使用。
APP_IMAGE=$(sed -n 's/^APP_IMAGE=//p' .env | tail -n 1 | tr -d '\r')
APP_IMAGE=${APP_IMAGE#\"}
APP_IMAGE=${APP_IMAGE%\"}
APP_IMAGE=${APP_IMAGE#\'}
APP_IMAGE=${APP_IMAGE%\'}
if ! printf '%s\n' "${APP_IMAGE}" \
  | grep -Eq '^ghcr\.io/527520/doupu(:v[0-9]+\.[0-9]+\.[0-9]+|@sha256:[0-9a-f]{64})$'; then
  echo "APP_IMAGE 必须是本仓库已发布的稳定 GHCR tag 或 digest（例如 ghcr.io/527520/doupu:v0.3.0）" >&2
  exit 1
fi
export APP_IMAGE

echo "==> 启动并等待 PostgreSQL"
"${COMPOSE[@]}" up -d postgres
ready=false
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U "${POSTGRES_USER:-doupu}" -d "${POSTGRES_DB:-doupu}" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "${ready}" != true ]]; then
  echo "PostgreSQL did not become ready" >&2
  exit 1
fi

echo "==> 拉取门禁通过的候选应用镜像，并构建独立备份工具镜像"
"${COMPOSE[@]}" pull app
"${COMPOSE[@]}" build backup

echo "==> 只读检查活动设计与分享快照均为严格 v3"
if "${COMPOSE[@]}" run --rm --no-deps app node deploy/scripts/check-protocol-v3.cjs; then
  :
else
  protocol_status=$?
  echo "协议发布前检查失败；未迁移、未删除数据，现有 Caddy/app 保持不变" >&2
  exit "${protocol_status}"
fi

echo "==> 短维护窗：停止入口并消除旧应用继续写入的竞态"
caddy_was_running=false
running_services=$("${COMPOSE[@]}" ps --status running --services)
if printf '%s\n' "${running_services}" | grep -Fxq caddy; then
  caddy_was_running=true
fi
restore_caddy_on_exit="${caddy_was_running}"
"${COMPOSE[@]}" stop caddy

echo "==> 停流后最终只读检查严格 v3"
if "${COMPOSE[@]}" run --rm --no-deps app node deploy/scripts/check-protocol-v3.cjs; then
  :
else
  protocol_status=$?
  echo "停流后的协议终检失败；未迁移、未删除数据、未替换应用" >&2
  exit "${protocol_status}"
fi

# 从这里开始数据库可能进入新协议，旧应用不再具备安全恢复条件。
restore_caddy_on_exit=false

echo "==> 在一次性任务中执行迁移（失败不切流）"
if "${COMPOSE[@]}" run --rm --no-deps app node db/migrate.cjs; then
  :
else
  migration_status=$?
  echo "数据库迁移失败；保持 Caddy 停止，禁止恢复旧协议应用" >&2
  exit "${migration_status}"
fi

echo "==> 替换 app"
"${COMPOSE[@]}" up -d --force-recreate --no-deps --no-build app

healthy=false
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T app node -e \
    "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ "${healthy}" != true ]]; then
  echo "候选应用健康检查失败；数据库已完成单向迁移，保持 Caddy 停止，禁止回滚旧协议镜像" >&2
  "${COMPOSE[@]}" logs app >&2 || true
  exit 1
fi

echo "==> 候选应用健康，切换 Caddy 并启动备份"
"${COMPOSE[@]}" up -d caddy backup
"${COMPOSE[@]}" ps
