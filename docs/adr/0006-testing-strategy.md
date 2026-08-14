# ADR-0006: Testing — Vitest unit, Playwright E2E, edge-case matrix, CI gates

- Status: accepted
- Date: 2026-08-14

## Context

The user requires a defect-free delivery with all edge cases covered. Upstream has zero tests. Everything we build is new enough to be born test-first.

## Decision

- **Pure logic lives in framework-free modules** under `src/lib/` (typed arrays / plain data in, plain data out): palette, quantization, dithering, merge, background removal, flood fill, undo/redo, project-file schema, sync conflict logic. No DOM, no React, no Next imports — so they run in Vitest at millisecond speed.
- **Vitest** unit tests for every `src/lib` module, driven by the edge-case matrix in the spec; coverage target ≥ 90% on `src/lib`.
- **Route-handler tests** exercise the API with a real Postgres test database (testcontainers or docker-compose test service), covering auth lifecycle, validation, limits, rate limiting.
- **Playwright E2E** covers the core journeys end-to-end in Chromium, Firefox and WebKit: register→verify→login; upload→crop→generate→edit→export (PNG/PDF/project file); save→sync→open on a second browser context.
- **Edge-case fixtures** are checked-in test assets: HEIC, EXIF-rotated JPEG, animated GIF, truncated/corrupt files, transparent PNG, 1×1 image, 8000×8000 image, grayscale, all-white, all-black, 16-bit PNG.
- **CI gates** on GitHub Actions: lint → typecheck → unit → build → E2E. A merge is blocked if any gate fails.
- Development follows TDD per ticket: red → green → refactor, tests committed with the code.

## Consequences

- The edge-case matrix in `SPEC.md` is normative: a behavior that is not covered by a test does not exist.
- E2E in CI costs minutes; acceptable. E2E also runs locally against the docker-compose stack.
- HEIC decoding fallback (WASM) is itself a risk surface and gets its own test fixture.
