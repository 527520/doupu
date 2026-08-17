# ADR-0008: Next.js 16 request nonce CSP

- Status: accepted
- Date: 2026-08-17
- Supersedes: ADR-0007

## Context

ADR-0007 retained `script-src 'unsafe-inline'` because the former Next.js 15
implementation did not have a stable project-approved path for applying a
nonce to framework and RSC scripts. Next.js 16 documents a first-party Proxy
flow: generate a nonce per request, put the nonce and CSP on the forwarded
request, and let the framework attach it to generated scripts and styles.

## Decision

- Upgrade the single application to Next.js 16 and use `src/proxy.ts` rather
  than a legacy middleware compatibility path.
- Generate a cryptographically random nonce for every HTML request.
- Put `x-nonce` and `Content-Security-Policy` on the forwarded request, and the
  same CSP on the response.
- Remove `script-src 'unsafe-inline'`. Development alone retains
  `script-src 'unsafe-eval'` because the framework development runtime needs it.
- Render the App Router tree dynamically so Next.js can read and apply the
  request nonce. The reverse proxy only transports the application CSP and
  never overrides it with a static policy.

## Consequences

- Static prerendering and ISR are intentionally disabled for the application.
- Every response has a distinct CSP and therefore cannot be served as a shared
  static HTML document.
- Any future third-party script must accept an explicit nonce or be rejected by
  the policy; weakening the global policy is not an acceptable integration.
- CSP behavior is verified in production-browser E2E, not only by unit-testing
  the header builder.
