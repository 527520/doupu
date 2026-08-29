import { describe, expect, it } from 'vitest';
import { collectAllowedDevOrigins } from './devOrigins';

describe('collectAllowedDevOrigins', () => {
  it('自动放行当前机器的局域网 IPv4 地址，同时保留显式来源', () => {
    const origins = collectAllowedDevOrigins('devbox.local', {
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [
        { address: '192.168.1.59', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
      en1: [{ address: '10.0.0.8', family: 'IPv4', internal: false }],
    });

    expect(origins).toEqual(['127.0.0.1', 'devbox.local', '192.168.1.59', '10.0.0.8']);
  });
});
