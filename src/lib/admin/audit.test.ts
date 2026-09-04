import { describe, expect, it } from 'vitest';
import { sanitizeAuditState } from './audit';

describe('admin audit state', () => {
  it('keeps only approved governance metadata', () => {
    expect(sanitizeAuditState({
      role: 'user',
      accountStatus: 'active',
      email: 'private@example.com',
      passwordHash: 'secret',
      commentBody: 'private body',
      token: 'secret-token',
      revision: 3,
    })).toEqual({ role: 'user', accountStatus: 'active', revision: 3 });
  });
});
