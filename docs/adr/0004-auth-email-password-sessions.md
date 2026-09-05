# ADR-0004: Authentication — email/password, argon2id, server sessions

- Status: accepted
- Date: 2026-08-14

## Context

Open registration with email + password, email verification and password reset (D12, D19, D24). No third-party OAuth in v1. Single-instance server, so no shared session store is required.

## Decision

- Password hashing: **argon2id** (memory 65536 KiB, iterations 3, parallelism 1 — OWASP recommended tier; upgraded 2026-08-15 from baseline 19456/2, verification of old hashes unaffected), via the `argon2` native binding.
- Sessions: opaque random 32-byte token, **SHA-256 hashed** at rest in the `sessions` table; cookie `doupu_session`, `HttpOnly`, `SameSite=Lax`, `Secure`, 30-day rolling expiry; logout deletes the row.
- Email tokens (verify / reset): single-use, random 32-byte, hashed at rest, 24 h expiry (verify), 1 h expiry (reset); consuming marks `used_at`.
- Rate limiting: per-IP and per-email counters for register/login/token-request (e.g. 10/hour), stored in DB; responses do not leak which field failed.
- All API input validated with zod; mutating requests require `Content-Type: application/json` + Origin check (defense in depth with SameSite=Lax).
- Password policy: 8–72 characters, any characters allowed except leading/trailing whitespace; change-password requires the current password; account deletion requires the password.

## Consequences

- An SMTP provider is required (腾讯云邮件推送 SES with SMTP credentials); without it, verification/reset emails cannot be delivered.
- argon2id hashing is CPU-bound: run it in a separate worker thread or accept ~100–300 ms latency on register/login (fine at this scale).
- No refresh tokens; expired sessions require re-login.

## 2026-09-05 clarification

Server Components resolve sessions read-only. Only Route Handlers renew both the database expiry and response Cookie. Read-only admin navigation and foreground activity probe `/api/auth/me`, so an active administrator does not lose rolling expiry merely by using server-rendered analytics, audit or system pages.
