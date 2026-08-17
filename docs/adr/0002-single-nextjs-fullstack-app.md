# ADR-0002: Single Next.js full-stack application

- Status: accepted
- Date: 2026-08-14

## Context

The product needs: client-side photo→pattern processing (upstream is a pure client app), plus accounts and cloud sync of pattern documents (decisions D1, D12, D13). Deployment target is a single 腾讯云 lightweight server with Docker (D26). Backend language is locked to Node.js + TypeScript (D14).

## Decision

One Next.js 16 (App Router) application serves everything:

- Pages for the workspace, design list, palette manager, account flows, help.
- Route Handlers under `/api/*` are the backend: auth, designs, palettes.
- All image processing stays client-side (Canvas/OffscreenCanvas); the server stores only JSON documents — original photos are never uploaded (D13).

No separate backend service, no GraphQL, no websockets. Synchronization remains pull-based; its
conflict protocol is defined by [ADR-0009](./0009-revision-cas-local-first-sync.md), which supersedes
the original last-write-wins choice in this paragraph.

## Consequences

- Single deployable unit; ops surface is minimal (matches the 50–100 CNY/month budget).
- Shared TypeScript domain types between client and API via `src/lib`.
- API is coupled to the Next.js runtime; fine at target scale (hobby/community, thousands of users). If scale ever demands it, the Route Handlers can be lifted into a standalone service behind the same contract.
- Long-running CPU work must never run on the server (only password hashing, JSON validation).
