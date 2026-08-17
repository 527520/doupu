import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';

describe('CSP proxy', () => {
  it('emits a different nonce policy for every document request', () => {
    const request = new NextRequest('https://doupu.example/app');
    const first = proxy(request).headers.get('Content-Security-Policy');
    const second = proxy(request).headers.get('Content-Security-Policy');

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    expect(first).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(first?.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'");
    expect(first).toContain("style-src-attr 'unsafe-inline'");
  });

  it('enables cross-origin isolation required by cooperative SharedArrayBuffer cancellation', () => {
    const response = proxy(new NextRequest('https://doupu.example/app'));
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });
});
