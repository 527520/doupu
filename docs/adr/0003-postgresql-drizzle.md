# ADR-0003: PostgreSQL 16 + Drizzle ORM

- Status: accepted
- Date: 2026-08-14

## Context

The backend stores users, sessions, email tokens, designs (JSON documents), and custom palettes. Single-instance deployment; backups to 腾讯云 COS. Alternatives considered: SQLite (single-file, but weaker for future multi-instance and JSON indexing), MySQL (equivalent, no advantage), MongoDB (unneeded).

## Decision

- **PostgreSQL 16** in Docker (docker-compose service).
- **Drizzle ORM** with SQL migration files under `db/migrations/` (reviewable, versioned SQL).
- Design documents stored as `jsonb`; `updated_at` indexed for sync queries.
- Email stored with `citext` + unique index on `lower(email)` to make addresses case-insensitive.
- Connection pooling via `pg` with a small pool (single instance).

## Consequences

- One extra container in the compose stack; daily `pg_dump` backups are trivial.
- JSONB gives schema-flexible project documents with validation enforced in the application layer (zod), not the DB.
- Migrations run automatically at deploy via `db:migrate` step.
