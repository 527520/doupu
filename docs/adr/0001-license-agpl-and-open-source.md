# ADR-0001: AGPL-3.0 license and open-source strategy

- Status: accepted
- Date: 2026-08-14

## Context

豆谱 (DouPu) is a derivative of [Zippland/perler-beads](https://github.com/Zippland/perler-beads). Primary-source check of the upstream `LICENSE` file confirms **AGPL-3.0** with an additional Chinese preamble forbidding repackaging as a closed-source commercial product. The upstream `CLAUDE.md` footer claiming "Apache 2.0" is stale documentation and must not be relied on. The user accepted AGPL and open-sourcing (decision D10), publishing on GitHub under account `527520` (D27).

## Decision

- 豆谱 is licensed under **AGPL-3.0** (version 3 only — the upstream grant does not offer "or later").
- The repository will be published at `github.com/527520/doupu`.
- The production site footer will link to the source repository (AGPL §13 network-use compliance).
- The codebase starts from a **fresh Next.js scaffold**; upstream modules that are reused (palette data, Oklab matching, cell sampling, flood fill, merge logic) are **ported with attribution**, not wholesale copied. `NOTICE.md` records the upstream origin, and ported files carry a header citing Zippland/perler-beads under AGPL-3.0.
- Upstream features that are out of our scope (AI optimization, donation modal, focus mode, PWA debug page) are simply not ported.

## Consequences

- Every distributed modification must remain AGPL-3.0; we cannot offer a proprietary license for this codebase.
- We must keep the upstream attribution and the AGPL license text intact in distributions.
- The upstream repo remains a reference for future improvements (it is actively maintained).
- The 微信小程序 PRD embedded in upstream's CLAUDE.md is upstream's roadmap, not ours — nothing from it is adopted unless the user explicitly asks.
