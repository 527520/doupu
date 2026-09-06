import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomId } from './ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('randomId', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('uses crypto.randomUUID when the context is secure', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555', getRandomValues: vi.fn() });
    expect(randomId()).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('falls back to getRandomValues on insecure origins where randomUUID is missing', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => { for (let i = 0; i < bytes.length; i += 1) bytes[i] = i * 17; return bytes; });
    vi.stubGlobal('crypto', { getRandomValues });
    const id = randomId();
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(id).toMatch(UUID_V4);
  });

  it('produces distinct v4 identifiers without any crypto object', () => {
    vi.stubGlobal('crypto', undefined);
    const ids = new Set(Array.from({ length: 50 }, () => randomId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});
