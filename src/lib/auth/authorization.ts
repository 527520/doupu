export const USER_ROLES = ['user', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ['active', 'suspended', 'anonymized'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type Capability =
  | 'community:interact'
  | 'community:moderate'
  | 'analytics:read'
  | 'official:manage'
  | 'users:manage'
  | 'moderation-rules:manage'
  | 'audit:read'
  | 'system:read';

export interface Actor {
  userId: string;
  role: UserRole;
  accountStatus: AccountStatus;
  emailVerified: boolean;
}

const ROLE_CAPABILITIES: Record<UserRole, ReadonlySet<Capability>> = {
  user: new Set(['community:interact']),
  moderator: new Set(['community:interact', 'community:moderate']),
  admin: new Set([
    'community:interact',
    'community:moderate',
    'analytics:read',
    'official:manage',
    'users:manage',
    'moderation-rules:manage',
    'audit:read',
    'system:read',
  ]),
};

export function authorize(actor: Actor | null, capability: Capability): boolean {
  return actor?.accountStatus === 'active'
    && actor.emailVerified
    && ROLE_CAPABILITIES[actor.role].has(capability);
}
