# ADR-0005: Deployment — 腾讯云 single host, Docker Compose, Caddy, COS backups

- Status: accepted
- Date: 2026-08-14

## Context

Deployment target: 腾讯云 lightweight server, single Docker host (~50–100 CNY/month), personal ICP 备案 (D11, D26, D27). Email via 腾讯云邮件推送. The user performs the human-only steps (buying the server, domain, ICP 备案, DNS) guided by our checklist.

## Decision

- `docker-compose.yml` with three services: `app` (Next.js standalone build), `postgres` (volume-persisted), `caddy` (reverse proxy + automatic TLS via Let's Encrypt HTTP-01; redirects HTTP→HTTPS; security headers).
- Nightly `pg_dump` via cron in a `backup` sidecar, uploaded to 腾讯云 COS with 30-day retention; restore procedure documented in `deploy/`.
- Secrets live in `.env` on the server (gitignored); `.env.example` documents every variable.
- GitHub Actions CI runs lint/typecheck/unit/build/E2E on every push and tag; the server pulls built images from the GitHub Container Registry via `deploy/scripts/deploy.sh` (run by the user or via SSH key they configure).
- Domain + ICP 备案 + DNS are documented as a step-by-step human checklist in `deploy/CHECKLIST.md` (备案 requires the domain to point at the server; a备案-compliant shell page is provided).

## Consequences

- Single point of failure is accepted; RTO after server loss ≈ image redeploy + latest nightly restore.
- Caddy terminates TLS; the app container itself is not exposed publicly.
- 备案 compliance requires a real-name domain and a non-commercial site footer (we are free/ad-free, which matches).
