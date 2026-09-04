import { describe, expect, it } from 'vitest';
import { authorize, type Actor } from './authorization';

const actor = (role: Actor['role'], accountStatus: Actor['accountStatus'] = 'active'): Actor => ({
  userId: '00000000-0000-4000-8000-000000000001',
  role,
  accountStatus,
  emailVerified: true,
});

describe('authorization', () => {
  it('enforces the role matrix and blocks every suspended account mutation', () => {
    expect(authorize(actor('user'), 'community:interact')).toBe(true);
    expect(authorize(actor('user'), 'community:moderate')).toBe(false);
    expect(authorize(actor('moderator'), 'community:moderate')).toBe(true);
    expect(authorize(actor('moderator'), 'analytics:read')).toBe(false);
    expect(authorize(actor('admin'), 'analytics:read')).toBe(true);
    expect(authorize(actor('admin'), 'users:manage')).toBe(true);
    expect(authorize(actor('admin', 'suspended'), 'community:interact')).toBe(false);
    expect(authorize(actor('admin', 'anonymized'), 'analytics:read')).toBe(false);
  });
});
