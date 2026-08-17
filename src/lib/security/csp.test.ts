import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './csp';

describe('buildContentSecurityPolicy', () => {
  it('uses a per-request nonce without allowing inline scripts', () => {
    const policy = buildContentSecurityPolicy('nonce-value', false);

    expect(policy).toContain("script-src 'self' 'nonce-nonce-value' 'strict-dynamic'");
    expect(policy).toContain("style-src-elem 'self' 'nonce-nonce-value'");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('only permits eval for the development runtime', () => {
    const developmentPolicy = buildContentSecurityPolicy('dev-nonce', true);
    const productionPolicy = buildContentSecurityPolicy('prod-nonce', false);

    expect(developmentPolicy).toContain("'unsafe-eval'");
    expect(developmentPolicy).toContain("style-src-elem 'self' 'unsafe-inline'");
    expect(productionPolicy).not.toContain("'unsafe-eval'");
    expect(productionPolicy).toContain("style-src-elem 'self' 'nonce-prod-nonce'");
  });

  it('returns a single-line header with restrictive defaults', () => {
    const policy = buildContentSecurityPolicy('abc', false);

    expect(policy).not.toMatch(/[\r\n]/);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});
