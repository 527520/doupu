# ADR-0005: Deployment — 腾讯云 single host, Docker Compose, Caddy, COS backups

- Status: accepted
- Date: 2026-08-14

## Context

Deployment target: 腾讯云海外地域 lightweight server, single Docker host (~50–100 CNY/month), with D31 superseding the earlier mainland/ICP decision D11. Email via 腾讯云邮件推送. The user performs the human-only steps (buying the server, domain and DNS) guided by our checklist.

## Decision

- `docker-compose.prod.yml` with four services: `app` (gated Next.js standalone image), `postgres` (volume-persisted), `caddy` (reverse proxy + automatic TLS via Let's Encrypt HTTP-01; redirects HTTP→HTTPS; security headers), and `backup`.
- Nightly verified `pg_dump` via the `backup` sidecar's fail-fast scheduling loop, uploaded to 腾讯云 COS with 30-day retention; restore procedure documented in `deploy/`. Backup or alert-path failure exits non-zero after bounded container retries instead of sleeping silently.
- Secrets live in `.env` on the server (gitignored); `.env.example` documents every variable.
- GitHub Actions CI runs the complete static/coverage/integration/performance/E2E/release-safety suite for a stable tag. `deploy/scripts/deploy.sh` accepts only that release's stable GHCR tag or immutable digest, pulls it, and starts it with `--no-build`; production never rebuilds the app from an arbitrary server checkout.
- Overseas-region selection, domain and DNS are documented as a step-by-step human checklist in `deploy/CHECKLIST.md`; moving the service to a mainland region requires a new decision and ICP workflow before traffic is switched.

## Consequences

- Single point of failure is accepted; RTO after server loss ≈ image redeploy + latest nightly restore.
- Caddy terminates TLS; the app container itself is not exposed publicly.
- The current overseas deployment does not claim an ICP filing number; mainland migration remains a separate compliance project.
