import { describe, expect, it } from 'vitest';
import { resolvePublicDisplayName } from './publicAuthor';

describe('public author display name', () => {
  it('never publishes an email-shaped username and masks the account email', () => {
    expect(resolvePublicDisplayName('other@example.net', 'alpha@example.com')).toBe('a***a@example.com');
    expect(resolvePublicDisplayName(null, 'x@example.com')).toBe('x***@example.com');
  });
});
