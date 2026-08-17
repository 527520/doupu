const normalizeHeader = (value: string) => value.replace(/\s{2,}/g, ' ').trim();

/**
 * Builds the request-scoped CSP consumed by Next.js while rendering.
 *
 * Keeping this pure makes the security contract testable without booting the
 * framework and prevents the reverse proxy from carrying framework knowledge.
 */
export const buildContentSecurityPolicy = (nonce: string, isDevelopment: boolean): string =>
  normalizeHeader(`
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''};
    style-src-elem 'self' ${isDevelopment ? "'unsafe-inline'" : `'nonce-${nonce}'`};
    style-src-attr 'unsafe-inline';
    img-src 'self' blob: data:;
    font-src 'self' data:;
    connect-src 'self';
    worker-src 'self' blob:;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    manifest-src 'self';
    ${isDevelopment ? '' : 'upgrade-insecure-requests;'}
  `);
