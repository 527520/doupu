# ADR-0010: Read-only share links with frozen snapshots

- Status: accepted
- Date: 2026-08-28
- Supersedes: the "no public share page" choice in CONTEXT.md D23 (share by exporting a project file)

## Context

D23 said sharing happens only by exporting and re-importing a project file. Users wanted a way to
send a pattern to friends who do not have an account, and every major competitor offers a link-based
share. The link must be read-only, must not expose the author's account or any original photo, and
must survive the author's continued editing without changing what the recipient sees.

## Decision

- A share is a frozen **snapshot** taken at share time: pattern cells, palette declaration, board
  profile, name and creation time only. Generation parameters, kit tier, the author's identity, the original photo and the local
  generation source (D13/D37) are all excluded. Project-file format upgrades never break old links.
- `POST /api/designs/[id]/share` creates the snapshot; `DELETE` revokes it. One design holds at most
  one live share: re-sharing invalidates the previous link (the user intent is "rotate the link").
- Tokens are 43-character URL-safe random values. The database stores only `sha256(token)`; a leaked
  database does not leak live links. Public access happens through `GET /s/[token]`, a server-
  rendered page with no auth, marked `noindex` so a private link is not handed to search engines.
- Revocation is authoritative: a revoked or never-issued token renders the standard not-found page.
- View counting increments per page load and records nothing about the visitor.

## Consequences

- Sharing is decoupled from both the project-file format and the sync protocol. Snapshot v3 is the
  only contract the public page consumes. There are no historical public shares or user data, so
  v1/v2 are deliberately rejected instead of carrying permanent compatibility branches.
- Revoking a share deletes the row, so recipients lose access instantly; the author must re-share to
  send an updated pattern (a fresh snapshot).
- The `design_shares` table (migration 0003) stores the snapshot as `jsonb` plus a hashed token with
  a unique index; it is independent of design deletion — a share survives deleting the design until
  explicitly revoked.
- The share write path is rate-limited like other synchronization writes (A-12).
